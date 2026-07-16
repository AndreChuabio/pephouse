import { Icon } from "@iconify/react";

type FakeSelectProps = {
  label: string;
  value: string;
};

export function FakeSelect({ label, value }: FakeSelectProps) {
  const fieldId = label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="text-xs font-medium text-faint">
        {label}
      </label>
      <button
        id={fieldId}
        type="button"
        className="w-full bg-base border border-line hover:border-line-bright rounded-md px-3 py-2 text-sm text-muted flex justify-between items-center transition-colors"
      >
        {value}
        <Icon icon="solar:alt-arrow-down-linear" className="text-faint" />
      </button>
    </div>
  );
}
