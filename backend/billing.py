"""Billing — Stripe Checkout and the entitlement it grants.

Money moves through exactly two paths, and both end at the same idempotent grant:

    webhook   POST /billing/webhook   checkout.session.completed
    return    POST /billing/confirm   the member lands back from Checkout

Both exist on purpose. The webhook is the durable path and survives a member who
closes the tab on the Stripe page. The return path is the one that works at a
booth on conference wifi before the webhook endpoint has even been configured in
the Stripe dashboard. Whichever arrives first grants; the other is a no-op,
because `entitlements.stripe_session_id` is unique and every write is an upsert
on it. A member cannot be granted twice for one payment, and a replayed webhook
is harmless.

Configuration is deliberately lazy. The module imports and the API boots with no
Stripe key present, so the rest of the product deploys and runs; only the
purchase endpoints refuse, with a clear error. That means the key can be added to
the environment later without touching code.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import stripe
from dotenv import load_dotenv

from db import supabase

load_dotenv()

logger = logging.getLogger("pephouse.billing")

PRODUCT = "stack_report"
PRODUCT_NAME = "PepHouse stack report"
PRODUCT_BLURB = "Tier-graded evidence read on every compound in your stack."

# Price in cents. Override with STACK_REPORT_PRICE_CENTS to change it without a
# deploy; the default is the current list price ($1 to start).
PRICE_CENTS = int(os.getenv("STACK_REPORT_PRICE_CENTS", "100"))
CURRENCY = os.getenv("STRIPE_CURRENCY", "usd")
# How long access lasts after purchase. 0 means it never expires.
ACCESS_DAYS = int(os.getenv("STACK_REPORT_ACCESS_DAYS", "30"))


class BillingNotConfigured(RuntimeError):
    """Raised when a purchase is attempted with no Stripe key in the environment."""


def _key() -> str:
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise BillingNotConfigured(
            "STRIPE_SECRET_KEY is not set; payments are not configured"
        )
    stripe.api_key = key
    return key


def is_configured() -> bool:
    """True when the backend can actually take a payment."""
    return bool(os.getenv("STRIPE_SECRET_KEY"))


# ---------------------------------------------------------------- entitlement


def _expiry() -> str | None:
    if ACCESS_DAYS <= 0:
        return None
    return (datetime.now(timezone.utc) + timedelta(days=ACCESS_DAYS)).isoformat()


def has_access(user_ref: str) -> bool:
    """True when this member holds an active, unexpired entitlement.

    Fails closed: if the store cannot be read we deny access rather than hand out
    the product, because the alternative is a database blip becoming a free tier.
    """
    if not user_ref:
        return False
    try:
        rows = (
            supabase.table("entitlements")
            .select("expires_at")
            .eq("user_ref", user_ref)
            .eq("product", PRODUCT)
            .eq("status", "active")
            .execute()
            .data
            or []
        )
    except Exception:  # noqa: BLE001
        logger.error("billing: entitlement lookup failed for %s", user_ref, exc_info=True)
        return False

    now = datetime.now(timezone.utc)
    for row in rows:
        expires = row.get("expires_at")
        if not expires:
            return True
        try:
            if datetime.fromisoformat(str(expires).replace("Z", "+00:00")) > now:
                return True
        except ValueError:
            logger.warning("billing: unparseable expires_at %r", expires)
    return False


def _grant(
    user_ref: str,
    session_id: str,
    email: str | None,
    amount_cents: int | None,
    currency: str | None,
    payment_intent: str | None = None,
    event_id: str | None = None,
) -> None:
    """Record a completed purchase. Idempotent on the Checkout session id.

    Upserting on `stripe_session_id` is what makes the webhook and the return path
    safe to both fire for the same payment: the second one overwrites the first
    with identical data instead of minting a second entitlement.

    The payment intent is stored because refund and dispute webhooks arrive keyed
    on it, not on the session — without it a chargeback could not find the access
    it needs to revoke.
    """
    record = {
        "user_ref": user_ref,
        "email": email,
        "product": PRODUCT,
        "status": "active",
        "expires_at": _expiry(),
        "stripe_session_id": session_id,
        "stripe_payment_intent": payment_intent,
        "amount_cents": amount_cents,
        "currency": currency,
    }
    if event_id:
        record["stripe_event_id"] = event_id
    supabase.table("entitlements").upsert(
        record, on_conflict="stripe_session_id"
    ).execute()
    logger.info("billing: entitlement granted to %s for session %s", user_ref, session_id)


def _revoke(payment_intent: str, reason: str) -> int:
    """Revoke every entitlement bought with this payment intent. Returns the count.

    A refunded or disputed payment must not leave paid access standing. The row is
    marked rather than deleted so the history of why access ended survives.
    """
    if not payment_intent:
        return 0
    res = (
        supabase.table("entitlements")
        .update({"status": reason})
        .eq("stripe_payment_intent", payment_intent)
        .eq("status", "active")
        .execute()
    )
    count = len(res.data or [])
    logger.info("billing: revoked %d entitlement(s) for %s (%s)", count, payment_intent, reason)
    return count


# ------------------------------------------------------------------- checkout


def create_checkout(user_ref: str, email: str | None, origin: str) -> str:
    """Open a Stripe Checkout session and return the URL to send the member to.

    `client_reference_id` and `metadata.user_ref` both carry the buyer, so the
    grant can be attributed from either the webhook payload or the retrieved
    session without trusting anything the browser sends back.
    """
    _key()
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": CURRENCY,
                    "unit_amount": PRICE_CENTS,
                    "product_data": {
                        "name": PRODUCT_NAME,
                        "description": PRODUCT_BLURB,
                    },
                },
                "quantity": 1,
            }
        ],
        client_reference_id=user_ref,
        metadata={"user_ref": user_ref, "product": PRODUCT},
        customer_email=email or None,
        success_url=f"{origin}/report?checkout={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/report?checkout=cancelled",
    )
    logger.info("billing: checkout opened for %s (%s)", user_ref, session.id)
    return session.url


def confirm(session_id: str, user_ref: str) -> bool:
    """Confirm a Checkout session on the member's return and grant if it is paid.

    This is the path that works before a webhook endpoint has been configured, so
    a first sale never depends on dashboard setup. The session is fetched from
    Stripe rather than trusted from the query string, and the buyer recorded on
    it must match the caller — otherwise anyone who learned a session id could
    claim someone else's purchase.
    """
    _key()
    session = stripe.checkout.Session.retrieve(session_id)

    if session.get("payment_status") != "paid":
        logger.info("billing: session %s not paid (%s)", session_id, session.get("payment_status"))
        return False

    buyer = session.get("client_reference_id") or (session.get("metadata") or {}).get("user_ref")
    if buyer != user_ref:
        logger.warning(
            "billing: %s tried to claim session %s belonging to %s", user_ref, session_id, buyer
        )
        return False

    _grant(
        user_ref=buyer,
        session_id=session_id,
        email=session.get("customer_email") or (session.get("customer_details") or {}).get("email"),
        amount_cents=session.get("amount_total"),
        currency=session.get("currency"),
        payment_intent=session.get("payment_intent"),
    )
    return True


def handle_webhook(payload: bytes, signature: str | None) -> str:
    """Verify and process a Stripe webhook. Returns the event type handled.

    The signature is verified against STRIPE_WEBHOOK_SECRET; an unverified body is
    rejected. Without that secret set, this endpoint refuses everything rather
    than trusting an unsigned POST, since granting on an unauthenticated request
    would let anyone mint themselves a paid entitlement.
    """
    _key()
    secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise BillingNotConfigured("STRIPE_WEBHOOK_SECRET is not set")
    if not signature:
        raise ValueError("missing Stripe-Signature header")

    event = stripe.Webhook.construct_event(payload, signature, secret)
    event_type = event["type"]

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        if session.get("payment_status") == "paid":
            buyer = session.get("client_reference_id") or (session.get("metadata") or {}).get("user_ref")
            if not buyer:
                logger.error("billing: paid session %s carried no user_ref", session.get("id"))
                return event_type
            _grant(
                user_ref=buyer,
                session_id=session["id"],
                email=session.get("customer_email")
                or (session.get("customer_details") or {}).get("email"),
                amount_cents=session.get("amount_total"),
                currency=session.get("currency"),
                payment_intent=session.get("payment_intent"),
                event_id=event["id"],
            )
    elif event_type in ("charge.refunded", "charge.dispute.created"):
        # A refunded or disputed payment must not leave paid access standing.
        obj = event["data"]["object"]
        reason = "refunded" if event_type == "charge.refunded" else "revoked"
        _revoke(obj.get("payment_intent") or "", reason)
    else:
        logger.debug("billing: ignoring event %s", event_type)

    return event_type
