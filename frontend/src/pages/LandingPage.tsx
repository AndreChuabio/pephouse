import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// The evidence tiers the twin actually reasons over, strongest first. Rendered
// as the hero's signature strip so the "honest evidence" thesis is visible
// before any copy is read.
const EVIDENCE_TIERS: ReadonlyArray<{ label: string; weight: string; tone: string }> = [
  { label: "Clinical trials", weight: "h-8", tone: "bg-cyan-400" },
  { label: "Cohort signal", weight: "h-5", tone: "bg-cyan-400/50" },
  { label: "Anecdote", weight: "h-3", tone: "bg-zinc-600" },
];

/** Public front door. Sits outside AppShell so it owns the full viewport. Both
 * CTAs land on the Galleria twin; the primary relies on the anonymous session
 * AuthProvider already established, the secondary upgrades to Google first. */
export default function LandingPage() {
  useDocumentTitle("PepHouse | Honest evidence for the peptide-curious");
  const navigate = useNavigate();
  const { signInWithGoogle } = useAuth();
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleTryIt = (): void => {
    navigate("/digital-twin");
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
    <div className="h-screen w-full overflow-hidden bg-[#0a0a0c] text-zinc-200 antialiased selection:bg-zinc-800 selection:text-white relative flex flex-col items-center justify-center px-6">
      {/* ambient glow, echoing AppShell's main surface */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] max-w-full h-[420px] bg-cyan-500/5 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-120px] left-1/2 -translate-x-1/2 w-[600px] max-w-full h-[300px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

      <main
        className={`relative z-10 w-full max-w-2xl flex flex-col items-center text-center motion-safe:transition-all motion-safe:duration-700 ${
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
        }`}
      >
        {/* wordmark eyebrow, matching the Sidebar brand treatment */}
        <div className="flex items-center gap-2.5 mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span className="text-xs font-medium uppercase tracking-[0.35em] text-zinc-400">
            Pephouse
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white leading-[1.05] text-balance">
          Honest evidence for the peptide-curious.
        </h1>

        <p className="mt-6 text-base sm:text-lg text-zinc-400 max-w-xl leading-relaxed">
          Tiered clinical evidence, your real biomarkers, no hype.
        </p>

        {/* signature: the evidence hierarchy the twin weighs, strongest first */}
        <div className="mt-12 flex items-end justify-center gap-8">
          {EVIDENCE_TIERS.map((tier) => (
            <div key={tier.label} className="flex flex-col items-center gap-3">
              <span className={`w-px ${tier.weight} ${tier.tone} rounded-full`} />
              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {tier.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col sm:flex-row items-center gap-3">
          <button
            type="button"
            onClick={handleTryIt}
            className="w-full sm:w-auto rounded-xl bg-cyan-600 hover:bg-cyan-500 px-7 py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
          >
            Try it now
            <Icon icon="lucide:arrow-right" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={authPending}
            className="w-full sm:w-auto rounded-xl border border-zinc-700 bg-zinc-950/60 hover:border-zinc-500 hover:bg-zinc-900 px-7 py-3 text-sm font-medium text-zinc-100 flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
          >
            <Icon
              icon={authPending ? "svg-spinners:180-ring" : "logos:google-icon"}
              className="w-4 h-4"
            />
            {authPending ? "Redirecting" : "Sign in with Google"}
          </button>
        </div>

        <p className="mt-5 text-xs text-zinc-600">
          No account needed to start. Sign in later to keep your data.
        </p>

        {authError && (
          <p className="mt-4 text-xs text-amber-400" role="alert">
            {authError}
          </p>
        )}
      </main>
    </div>
  );
}
