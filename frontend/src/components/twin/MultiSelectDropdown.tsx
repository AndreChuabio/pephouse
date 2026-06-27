import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";

type MultiSelectDropdownProps = {
  label: string;
  icon: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

/** Compact multi-select dropdown (checkbox list) for goals / conditions. */
export function MultiSelectDropdown({
  label,
  icon,
  options,
  selected,
  onChange,
  placeholder = "Select…",
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);

  return (
    <div className="relative" ref={ref}>
      <label className="text-[12px] font-medium text-zinc-500 mb-1.5 flex items-center gap-1.5">
        <Icon icon={icon} className="w-3.5 h-3.5" /> {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-[#0a0a0a] border border-zinc-700/80 rounded-lg py-2 px-3 text-sm text-left flex items-center justify-between gap-2 outline-none focus:border-zinc-500 transition-colors"
      >
        <span className={selected.length ? "text-zinc-200 truncate" : "text-zinc-500"}>
          {selected.length ? `${selected.length} selected` : placeholder}
        </span>
        <Icon icon="lucide:chevron-down" className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((s) => (
            <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/40 border border-cyan-800/50 text-cyan-200 flex items-center gap-1">
              {s}
              <button type="button" onClick={() => toggle(s)} className="hover:text-white">
                <Icon icon="lucide:x" className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-zinc-700 bg-[#0d0f12] shadow-2xl p-1">
          {options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left text-zinc-200 hover:bg-zinc-800/60 transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-cyan-500 border-cyan-500" : "border-zinc-600"}`}>
                  {on && <Icon icon="lucide:check" className="w-3 h-3 text-white" />}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
