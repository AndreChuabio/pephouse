type SliderTrackProps = {
  percent: number;
  size?: "sm" | "md";
  accent?: "neutral" | "blue";
};

const THUMB_CLASS = {
  sm: "w-2.5 h-2.5 bg-blue-400",
  md: "w-3 h-3 bg-white border border-zinc-300 shadow",
} as const;

const TRACK_CLASS = {
  sm: "h-1",
  md: "h-1.5",
} as const;

const FILL_CLASS = {
  neutral: "bg-zinc-600",
  blue: "bg-blue-500/80",
} as const;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function SliderTrack({ percent, size = "sm", accent = "blue" }: SliderTrackProps) {
  const clamped = clampPercent(percent);

  return (
    <div className={`w-full ${TRACK_CLASS[size]} bg-zinc-800 rounded-full relative`}>
      <div
        className={`absolute left-0 top-0 h-full rounded-full ${FILL_CLASS[accent]}`}
        style={{ width: `${clamped}%` }}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-full cursor-grab ${THUMB_CLASS[size]}`}
        style={{ left: `${clamped}%` }}
      />
    </div>
  );
}
