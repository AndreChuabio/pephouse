import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { EvidenceMeter } from "../components/ui/EvidenceMeter";

// The hero signature: a live assay readout. Three real compounds against their
// actual top evidence tier, so the thesis — most of what people inject is not
// trial-backed — is legible before a word of copy is read. This is the product
// in miniature: the meter, the mono verdict, the honest spread.
const READOUT: ReadonlyArray<{ name: string; tier: number; verdict: string }> = [
  { name: "Tirzepatide", tier: 4, verdict: "TRIAL-BACKED" },
  { name: "CJC-1295", tier: 2, verdict: "SOURCE DATA ONLY" },
  { name: "BPC-157", tier: 1, verdict: "ANECDOTE ONLY" },
];

/** Public front door. Sits outside AppShell so it owns the full viewport. Both
 * CTAs land on the Galleria twin; the primary relies on the anonymous session
 * AuthProvider already established, the secondary upgrades to Google first. */
export default function LandingPage() {
  useDocumentTitle("PepHouse | Honest evidence for the peptide-curious");
  const navigate = useNavigate();
  // isAnonymous distinguishes a real Google account from the anonymous session
  // every visitor starts with. A signed-in member returning to the landing page
  // (for example by clicking the wordmark) must see that they are signed in and
  // an option to enter — not the sign-in button, which re-runs the OAuth
  // redirect and reads as being logged out.
  const { signInWithGoogle, signOut, isAnonymous, email } = useAuth();
  const signedIn = !isAnonymous;
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleTryIt = (): void => {
    // The stack report is the front door: a member picks what they are running
    // and gets the honest verdict for free before anything is asked of them.
    navigate("/report");
  };

  const handleGoogle = async (): Promise<void> => {
    setAuthPending(true);
    setAuthError(null);
    try {
      // On success the OAuth call redirects the whole browser to Google and
      // returns to the post-auth route, so there is no in-page navigation to
      // do here; navigating before the redirect only flashes the twin page.
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      setAuthPending(false);
    }
  };

  return (
    // min-h-screen rather than h-screen + overflow-hidden: the disclosures below
    // must never be clipped, and most of the traffic that matters is on a phone.
    <div className="min-h-screen w-full bg-base text-ink antialiased relative flex flex-col items-center justify-center px-6 py-16">
      {/* The instrument's power light — a single warm signal glow, top-center. */}
      <div className="absolute top-[-60px] left-1/2 -translate-x-1/2 w-[900px] max-w-full h-[420px] bg-signal/[0.06] rounded-full blur-[140px] pointer-events-none" />

      <main
        className={`relative z-10 w-full max-w-xl flex flex-col items-center text-center motion-safe:transition-all motion-safe:duration-700 ${
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        {/* wordmark eyebrow with the live pulse, matching the Sidebar brand */}
        <div className="flex items-center gap-2.5 mb-10">
          <span className="relative flex h-2 w-2">
            <span className="pulse-signal absolute inline-flex h-2 w-2 rounded-full bg-signal" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
          </span>
          <span className="eyebrow !text-muted">PepHouse</span>
        </div>

        <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] font-semibold tracking-[-0.03em] text-ink leading-[1.02] text-balance">
          Honest evidence for the peptide-curious.
        </h1>

        <p className="mt-6 text-base sm:text-lg text-muted max-w-md leading-relaxed">
          We rank how strong the evidence actually is — completed trials, papers, lab
          assays, or nothing — and call “no data” what it is: a finding, not a blank.
        </p>

        {/* signature: a live assay readout — real compounds against their true
            evidence tier, the meter doing the talking */}
        <div className="mt-11 w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface/60 backdrop-blur-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
            <span className="eyebrow">Live readout</span>
            <span className="readout text-[11px] text-faint">trials → anecdote</span>
          </div>
          <div className="divide-y divide-line/70">
            {READOUT.map((row) => (
              <div key={row.name} className="flex items-center gap-4 px-4 py-3 text-left">
                <EvidenceMeter tier={row.tier} className="shrink-0" />
                <span className="font-display text-sm font-medium text-ink flex-1">
                  {row.name}
                </span>
                <span
                  className={`readout text-[10px] tracking-wide ${
                    row.tier >= 4
                      ? "text-ink"
                      : row.tier >= 3
                        ? "text-tier-3"
                        : row.tier >= 2
                          ? "text-tier-2"
                          : "text-tier-1"
                  }`}
                >
                  {row.verdict}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* one honest caption tying the meter to the rule it enforces */}
        <p className="mt-3 text-[11px] leading-relaxed text-faint max-w-md">
          Same scale for everything. A completed trial and a forum post never render alike.
        </p>

        <div className="mt-11 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleTryIt}
            className="w-full sm:w-auto rounded-xl bg-signal hover:bg-signal-bright px-7 py-3 text-sm font-semibold text-on-signal flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            {signedIn ? "Enter" : "Read my stack"}
            <Icon icon="lucide:arrow-right" className="w-4 h-4" />
          </button>
          {!signedIn && (
            <button
              type="button"
              onClick={handleGoogle}
              disabled={authPending}
              className="w-full sm:w-auto rounded-xl border border-line bg-surface/60 hover:border-line-bright hover:bg-surface px-7 py-3 text-sm font-medium text-ink flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-bright focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              <Icon
                icon={authPending ? "svg-spinners:180-ring" : "logos:google-icon"}
                className="w-4 h-4"
              />
              {authPending ? "Redirecting" : "Sign in with Google"}
            </button>
          )}
        </div>

        {signedIn ? (
          <p className="mt-5 text-xs text-muted">
            Signed in{email ? ` as ${email}` : ""}.{" "}
            <button
              type="button"
              onClick={() => void signOut()}
              className="underline underline-offset-2 hover:text-ink transition-colors"
            >
              Sign out
            </button>
          </p>
        ) : (
          <p className="mt-5 text-xs text-faint">
            No account needed to start. Sign in later to keep your data.
          </p>
        )}

        {authError && (
          <p className="mt-4 text-xs text-danger" role="alert">
            {authError}
          </p>
        )}

        {/* the unpurchasable-index thesis, surfaced as a visible trust line rather
            than left to the footer fine print */}
        <div className="mt-8 flex items-center gap-2 text-[11px] text-muted">
          <Icon icon="lucide:lock" className="w-3 h-3 text-faint shrink-0" />
          <span>No vendor pays us. The index can’t be bought.</span>
        </div>
      </main>

      {/* Required disclosures. This is a health product that takes payment, so
          they belong on the front door in language a person will actually read,
          not buried in a terms page nobody opens. */}
      <footer className="relative z-10 mt-12 w-full max-w-xl text-center">
        <p className="text-[11px] leading-relaxed text-faint">
          PepHouse is education, not medical advice. It does not diagnose, treat, or
          prescribe, and it is not a substitute for a licensed clinician. Several
          compounds in this registry are not approved for human use, and some carry
          documented harms. Talk to a doctor before taking anything.
        </p>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Your health data stays yours. We store what you enter so your report works,
          we never sell it, and you can delete all of it at any time from{" "}
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="underline underline-offset-2 hover:text-muted transition-colors"
          >
            Settings
          </button>
          . We take no money from peptide vendors, and no vendor can pay for a listing,
          a rating, or a position in our index.
        </p>
      </footer>
    </div>
  );
}
