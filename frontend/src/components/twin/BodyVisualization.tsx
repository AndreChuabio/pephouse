// Digital-twin body — a simplified holographic wireframe figure with a glowing
// base platform and heart node. Cyan/blue line-art so it reads as a "twin"
// hologram while staying calm against the dark dashboard background.

type BodyVisualizationProps = {
  active: boolean; // true once real data is linked → the twin lights up
};

export function BodyVisualization({ active }: BodyVisualizationProps) {
  const stroke = active ? "#22d3ee" : "#3f3f46";
  const glow = active ? 0.9 : 0.25;

  return (
    <div className="relative w-full max-w-sm mx-auto h-[560px] flex items-center justify-center">
      <svg
        viewBox="0 0 200 460"
        className="h-full w-auto relative z-10"
        style={{ transition: "filter 600ms ease", filter: active ? "drop-shadow(0 0 6px rgba(34,211,238,0.5))" : "none" }}
        aria-label="Digital twin body"
      >
        <defs>
          <linearGradient id="wire" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={glow} />
            <stop offset="100%" stopColor={stroke} stopOpacity={glow * 0.5} />
          </linearGradient>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity={active ? 0.9 : 0.1} />
            <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g
          fill="none"
          stroke="url(#wire)"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {/* head + neck */}
          <ellipse cx="100" cy="40" rx="20" ry="24" />
          <path d="M92 62 L92 76 M108 62 L108 76" />
          {/* torso outline */}
          <path d="M64 86 Q100 72 136 86 L148 98 Q150 134 144 178 Q138 212 128 238 L72 238 Q62 212 56 178 Q50 134 52 98 Z" />
          {/* centre + rib hints (wireframe) */}
          <path d="M100 80 L100 238" opacity="0.5" />
          <path d="M74 120 Q100 132 126 120 M72 150 Q100 164 128 150 M74 182 Q100 194 126 182" opacity="0.4" />
          {/* arms */}
          <path d="M64 88 Q44 98 40 132 Q36 172 34 210" />
          <path d="M136 88 Q156 98 160 132 Q164 172 166 210" />
          {/* hips */}
          <path d="M72 238 L128 238 Q134 258 130 274 L70 274 Q66 258 72 238 Z" />
          {/* legs */}
          <path d="M70 272 Q72 342 80 402 Q83 434 92 438" />
          <path d="M130 272 Q128 342 120 402 Q117 434 108 438" />
          <path d="M100 274 L100 430" opacity="0.4" />
        </g>

        {/* heart core */}
        <circle cx="100" cy="150" r="26" fill="url(#coreGlow)" />
        <circle cx="100" cy="150" r="3.5" fill={active ? "#a5f3fc" : "#52525b"}>
          {active && <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />}
        </circle>
      </svg>

      {/* holographic base platform */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[260px] h-16 pointer-events-none">
        <div
          className="absolute inset-0 rounded-[100%] border border-cyan-500/40"
          style={{ transform: "rotateX(72deg)", boxShadow: active ? "0 0 30px rgba(34,211,238,0.35)" : "none" }}
        />
        <div
          className="absolute inset-x-10 inset-y-3 rounded-[100%] border border-blue-400/50"
          style={{ transform: "rotateX(72deg)" }}
        />
        <div
          className={`absolute inset-x-20 inset-y-5 rounded-[100%] ${active ? "bg-cyan-500/20" : "bg-zinc-700/10"}`}
          style={{ transform: "rotateX(72deg)" }}
        />
      </div>

      {/* upward beam */}
      {active && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-40 h-72 bg-gradient-to-t from-cyan-400/15 via-cyan-500/5 to-transparent blur-xl rounded-[100%] pointer-events-none" />
      )}
    </div>
  );
}
