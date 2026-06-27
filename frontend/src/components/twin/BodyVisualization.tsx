// Digital-twin body — a stylized anterior silhouette with a pulsing heart
// glow, echoing the Superpower/Twin dashboard. Pure SVG so it works offline.

type BodyVisualizationProps = {
  active: boolean; // true once real data is linked → the twin "comes alive"
};

export function BodyVisualization({ active }: BodyVisualizationProps) {
  return (
    <div className="relative w-full max-w-sm mx-auto h-[600px] flex items-center justify-center">
      <svg
        viewBox="0 0 200 460"
        className="h-full w-auto"
        style={{
          filter: active ? "none" : "saturate(0.4)",
          opacity: active ? 0.95 : 0.55,
          transition: "opacity 600ms ease, filter 600ms ease",
        }}
        aria-label="Digital twin body"
      >
        <defs>
          <linearGradient id="bodyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f3f46" />
            <stop offset="55%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#18181b" />
          </linearGradient>
          <radialGradient id="bodySheen" cx="40%" cy="22%" r="70%">
            <stop offset="0%" stopColor="#52525b" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#52525b" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g fill="url(#bodyFill)" stroke="#3f3f46" strokeWidth="0.75">
          {/* head + neck */}
          <ellipse cx="100" cy="38" rx="22" ry="26" />
          <rect x="90" y="60" width="20" height="16" rx="8" />
          {/* shoulders + torso */}
          <path d="M62 86 Q100 70 138 86 L150 96 Q152 130 146 176 Q140 210 130 236 L70 236 Q60 210 54 176 Q48 130 50 96 Z" />
          {/* arms */}
          <path d="M62 88 Q44 96 40 130 Q36 170 34 208 Q33 224 41 226 Q49 226 51 210 Q56 168 62 132 Z" />
          <path d="M138 88 Q156 96 160 130 Q164 170 166 208 Q167 224 159 226 Q151 226 149 210 Q144 168 138 132 Z" />
          {/* hips */}
          <path d="M70 236 L130 236 Q136 256 132 272 L68 272 Q64 256 70 236 Z" />
          {/* legs */}
          <path d="M70 270 Q72 340 80 400 Q83 432 92 436 Q100 434 99 404 Q98 340 100 274 Z" />
          <path d="M130 270 Q128 340 120 400 Q117 432 108 436 Q100 434 101 404 Q102 340 100 274 Z" />
        </g>
        <g fill="url(#bodySheen)" opacity="0.5">
          <path d="M62 86 Q100 70 138 86 L150 96 Q152 130 146 176 Q140 210 130 236 L70 236 Q60 210 54 176 Q48 130 50 96 Z" />
        </g>
      </svg>

      {/* heart glow + pulse */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 rounded-full blur-2xl transition-all duration-700 ${
          active ? "w-28 h-28 bg-emerald-500/25" : "w-20 h-20 bg-zinc-500/10"
        }`}
        style={{ top: "30%" }}
      />
      <div
        className={`absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full transition-all duration-700 ${
          active ? "bg-emerald-400 animate-pulse shadow-[0_0_20px_rgba(52,211,153,1)]" : "bg-zinc-600"
        }`}
        style={{ top: "32%" }}
      />
    </div>
  );
}
