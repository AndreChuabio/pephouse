import { Icon } from "@iconify/react";

type FakeSelectProps = {
  label: string;
  value: string;
};

export function FakeSelect({ label, value }: FakeSelectProps) {
  const fieldId = label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="text-xs font-medium text-zinc-500">
        {label}
      </label>
      <button
        id={fieldId}
        type="button"
        className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 flex justify-between items-center transition-colors"
      >
        {value}
        <Icon icon="solar:alt-arrow-down-linear" className="text-zinc-500" />
      </button>
    </div>
  );
}
