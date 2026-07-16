import { cn } from "../../lib/cn";

interface EvidenceMeterProps {
  /** Top evidence tier, 0-4. 4 = completed trials, 1 = anecdote, 0 = nothing. */
  tier: number;
  className?: string;
}

/**
 * The evidence meter — the product's signature mark.
 *
 * Four segments, filled up to the top tier a compound or vendor has reached, in
 * that tier's luminance. Empty rungs stay visible as hairlines because the gap
 * is the finding. The fill is a neutral luminance ramp, never a good/bad hue:
 * evidence strength is not the same as safety, and the mark must not imply it.
 */
export function EvidenceMeter({ tier, className }: EvidenceMeterProps) {
  const top = Math.max(0, Math.min(4, Math.round(tier)));
  return (
    <span className={cn("meter", className)} role="img" aria-label={`Evidence tier ${top} of 4`}>
      {[1, 2, 3, 4].map((seg) => (
        <span
          key={seg}
          className="meter-seg"
          data-h={seg}
          data-on={seg <= top}
          data-tier={top}
        />
      ))}
    </span>
  );
}
