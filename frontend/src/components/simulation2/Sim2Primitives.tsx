import { cn } from "../../lib/cn";

type CustomCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
};

export function CustomCheckbox({ checked, onChange, disabled, id }: CustomCheckboxProps) {
  return (
    <div className="relative flex items-center">
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={cn(
          "w-3.5 h-3.5 border border-zinc-700 rounded-[3px] bg-[#0A0A0A] transition-colors flex items-center justify-center",
          checked && "bg-zinc-100 border-zinc-100",
          !disabled && "group-hover:border-zinc-500",
        )}
      >
        <svg
          className={cn("w-2.5 h-2.5 text-zinc-900 pointer-events-none", checked ? "block" : "hidden")}
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
        >
          <path
            d="M3 7L6 10L11 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

export function TierBadge({ tier }: { tier: 1 | 2 | 3 | 4 }) {
  const styles: Record<1 | 2 | 3 | 4, string> = {
    4: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    3: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    2: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    1: "bg-zinc-800/50 text-zinc-400 border-zinc-700/50",
  };

  return (
    <span
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 rounded-sm border shrink-0",
        styles[tier],
      )}
    >
      Tier {tier}
    </span>
  );
}