// Digital-twin body — a holographic anatomical figure: a glowing blue body with
// a wireframe mesh, internal organ glow (lungs/heart warm, abdomen soft), and a
// base platform. A cleaned-up, calmer take on the reference x-ray render.

type BodyVisualizationProps = {
  active: boolean; // true once real data is linked → the twin lights up
};

export function BodyVisualization({ active }: BodyVisualizationProps) {
  const line = active ? "#38bdf8" : "#3f3f46";
  const fill = active ? "#0ea5e9" : "#27272a";

  return (
    <div className="relative w-full max-w-sm mx-auto h-[600px] flex items-center justify-center">
      <svg
        viewBox="0 0 220 480"
        className="h-full w-auto relative z-10"
        style={{ filter: active ? "drop-shadow(0 0 10px rgba(56,189,248,0.55))" : "none", transition: "filter 600ms ease" }}
        aria-label="Digital twin body"
      >
        <defs>
          <linearGradient id="bodyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={active ? 0.32 : 0.12} />
            <stop offset="100%" stopColor={fill} stopOpacity={active ? 0.12 : 0.05} />
          </linearGradient>
          <radialGradient id="lungGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={active ? 0.7 : 0} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="gutGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={active ? 0.5 : 0.05} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* filled body silhouette (soft) */}
        <g fill="url(#bodyFill)" stroke={line} strokeWidth="1" strokeOpacity={active ? 0.8 : 0.4}>
          <ellipse cx="110" cy="42" rx="22" ry="26" />
          <path d="M98 66 Q110 72 122 66 L122 80 Q110 86 98 80 Z" />
          <path d="M70 92 Q110 76 150 92 L162 106 Q165 150 158 196 Q150 232 138 258 L82 258 Q70 232 62 196 Q55 150 58 106 Z" />
          {/* arms */}
          <path d="M70 94 Q48 104 43 140 Q39 184 36 226 Q35 240 43 242 Q51 242 53 228 Q58 184 64 142 Q67 116 76 100 Z" />
          <path d="M150 94 Q172 104 177 140 Q181 184 184 226 Q185 240 177 242 Q169 242 167 228 Q162 184 156 142 Q153 116 144 100 Z" />
          {/* hips + legs */}
          <path d="M82 258 L138 258 Q146 280 142 300 L78 300 Q74 280 82 258 Z" />
          <path d="M78 298 Q80 372 88 432 Q91 462 100 466 Q110 464 109 434 Q108 372 110 300 Z" />
          <path d="M142 298 Q140 372 132 432 Q129 462 120 466 Q110 464 111 434 Q112 372 110 300 Z" />
        </g>

        {/* organ glows */}
        <circle cx="110" cy="150" r="34" fill="url(#lungGlow)" />
        <circle cx="110" cy="210" r="30" fill="url(#gutGlow)" />

        {/* wireframe mesh — horizontal contour lines + spine */}
        <g stroke={line} strokeWidth="0.7" strokeOpacity={active ? 0.55 : 0.25} fill="none">
          <path d="M110 80 L110 300" />
          <path d="M66 120 Q110 134 154 120 M62 150 Q110 166 158 150 M64 184 Q110 200 156 184 M70 220 Q110 236 150 220 M80 252 Q110 266 140 252" />
          {/* limb contour ticks */}
          <path d="M52 140 L62 140 M49 175 L60 175 M47 210 L57 210" />
          <path d="M168 140 L158 140 M171 175 L160 175 M173 210 L163 210" />
          <path d="M86 340 L110 346 L134 340 M88 392 L110 398 L132 392" />
        </g>

        {/* heart node */}
        <circle cx="103" cy="150" r="3.5" fill={active ? "#fcd34d" : "#52525b"}>
          {active && <animate attributeName="r" values="3;5;3" dur="1.8s" repeatCount="indefinite" />}
        </circle>
      </svg>

      {/* holographic base platform */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[280px] h-16 pointer-events-none">
        <div className="absolute inset-0 rounded-[100%] border border-sky-500/40" style={{ transform: "rotateX(73deg)", boxShadow: active ? "0 0 34px rgba(56,189,248,0.4)" : "none" }} />
        <div className="absolute inset-x-12 inset-y-3 rounded-[100%] border border-blue-400/50" style={{ transform: "rotateX(73deg)" }} />
        <div className={`absolute inset-x-24 inset-y-5 rounded-[100%] ${active ? "bg-sky-500/25" : "bg-zinc-700/10"}`} style={{ transform: "rotateX(73deg)" }} />
      </div>

      {active && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-44 h-80 bg-gradient-to-t from-sky-400/15 via-sky-500/5 to-transparent blur-2xl rounded-[100%] pointer-events-none" />
      )}
    </div>
  );
}
