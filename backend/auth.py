"""Request authentication for the pephouse API.

Identity comes from the Supabase access token in the ``Authorization`` header and
never from a client-supplied ``user_ref``. Before this module existed every
user-keyed endpoint trusted whatever string the caller sent, so any client could
read, write, or delete another member's health data by guessing their ref.

Tokens are validated against Supabase Auth (``GET /auth/v1/user``). Results are
cached for a short TTL so a page that fires several calls at once does not become
several auth round-trips.

Anonymous Supabase sessions are real, signed sessions with a stable user id, so
they authenticate fine and can own their own data. Anything that costs money
(purchases, entitlements) additionally requires a non-anonymous account via
``require_account`` — an anonymous session that is lost cannot be recovered, and
neither could the entitlement attached to it.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException

load_dotenv()

logger = logging.getLogger("pephouse.auth")

SUPABASE_URL = os.environ["SUPABASE_URL"]
# The apikey header Supabase Auth requires alongside the bearer token. The anon
# key is the correct value and is public by design; fall back to the service-role
# key so an existing deploy keeps working before the new var is set.
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Emails allowed to reach operator surfaces: the vendor review queue and the
# intake queue. Comma-separated, overridable by env.
#
# The owner's account is the default rather than an empty set. An empty default
# is the safer-looking choice and the wrong one here: it means a deploy that
# forgets the env var locks the owner out of his own review queue, and he finds
# out while standing at a conference booth with a vendor waiting. This is not a
# secret — it is an allowlist of one, and controlling that Google account is
# already equivalent to owning the product.
DEFAULT_ADMIN_EMAILS = "andre102599@gmail.com"
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", DEFAULT_ADMIN_EMAILS).split(",")
    if email.strip()
}

_CACHE_TTL_SECONDS = 60.0
_MAX_CACHE_ENTRIES = 2048


@dataclass(frozen=True)
class AuthUser:
    """The authenticated caller, resolved from a verified Supabase token."""

    id: str
    email: str | None
    is_anonymous: bool

    @property
    def is_admin(self) -> bool:
        """True when this account is on the operator allowlist."""
        return bool(self.email) and self.email.lower() in ADMIN_EMAILS


# token -> (expires_at, user). Bounded so a token-spraying caller cannot grow it
# without limit.
_cache: dict[str, tuple[float, AuthUser]] = {}


def _cache_get(token: str) -> AuthUser | None:
    entry = _cache.get(token)
    if entry is None:
        return None
    expires_at, user = entry
    if expires_at < time.monotonic():
        _cache.pop(token, None)
        return None
    return user


def _cache_put(token: str, user: AuthUser) -> None:
    if len(_cache) >= _MAX_CACHE_ENTRIES:
        _cache.clear()
    _cache[token] = (time.monotonic() + _CACHE_TTL_SECONDS, user)


def _bearer(authorization: str | None) -> str:
    """Pull the bearer token out of an Authorization header, or 401."""
    if not authorization:
        raise HTTPException(status_code=401, detail="authentication required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="expected a bearer token")
    return token.strip()


async def _verify(token: str) -> AuthUser:
    """Resolve a Supabase access token to its user, or raise 401.

    Supabase is the source of truth: a revoked or expired token fails here even
    if it is well-formed, which local signature checking alone would not catch.
    """
    cached = _cache_get(token)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        logger.error("auth: supabase unreachable", exc_info=True)
        raise HTTPException(status_code=503, detail="auth unavailable") from exc

    if res.status_code == 401 or res.status_code == 403:
        raise HTTPException(status_code=401, detail="invalid or expired session")
    if res.status_code >= 400:
        logger.error("auth: supabase returned %s: %s", res.status_code, res.text[:200])
        raise HTTPException(status_code=503, detail="auth unavailable")

    payload = res.json()
    user_id = payload.get("id")
    if not user_id:
        logger.error("auth: supabase user payload had no id")
        raise HTTPException(status_code=401, detail="invalid session")

    user = AuthUser(
        id=str(user_id),
        email=payload.get("email"),
        is_anonymous=bool(payload.get("is_anonymous", False)),
    )
    _cache_put(token, user)
    return user


async def require_user(authorization: str | None = Header(default=None)) -> AuthUser:
    """Dependency: any authenticated session, anonymous included."""
    return await _verify(_bearer(authorization))


async def require_account(user: AuthUser = Depends(require_user)) -> AuthUser:
    """Dependency: a durable (non-anonymous) account. Required to spend money."""
    if user.is_anonymous:
        raise HTTPException(status_code=403, detail="sign in to continue")
    return user


async def require_admin(user: AuthUser = Depends(require_user)) -> AuthUser:
    """Dependency: an operator account, for internal surfaces like the intake queue."""
    if not user.is_admin:
        logger.warning("auth: admin surface refused for %s", user.id)
        raise HTTPException(status_code=403, detail="not permitted")
    return user


def assert_self(user: AuthUser, user_ref: str) -> None:
    """Guard a ``/users/{user_ref}/...`` route against cross-account access.

    The route keeps its shape so existing clients and links still work, but the
    path segment is now checked against the verified token rather than trusted.
    """
    if user_ref != user.id:
        logger.warning("auth: %s attempted to access data for %s", user.id, user_ref)
        raise HTTPException(status_code=403, detail="not permitted")
