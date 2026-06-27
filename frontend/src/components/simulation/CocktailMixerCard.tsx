import { MOCK_COMPOUNDS } from "../../data/mockSimulation";
import { useCompounds } from "../../hooks/useCompounds";
import { cn } from "../../lib/cn";
import { getTierBadge } from "../../lib/badges";
import type { Compound } from "../../types/simulation";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";

type CocktailMixerCardProps = {
  selectedId: number | null;
  onSelect: (id: number) => void;
};

type CompoundRowProps = {
  compound: Compound;
  selected: boolean;
  onSelect: () => void;
};

function CompoundRow({ compound, selected, onSelect }: CompoundRowProps) {
  const badge = getTierBadge(compound.tier);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left bg-zinc-950 border rounded-lg p-3 transition-colors",
        selected ? "border-blue-500 ring-1 ring-blue-500/30" : "border-zinc-800 hover:border-zinc-600",
      )}
    >
      <div className="text-sm font-medium text-zinc-200 flex items-center gap-2">
        {compound.name}
        <span className={badge.className}>{badge.label}</span>
      </div>
      <p className="text-xs text-zinc-500 mt-0.5">{compound.description}</p>
    </button>
  );
}

export function CocktailMixerCard({ selectedId, onSelect }: CocktailMixerCardProps) {
  const { compounds } = useCompounds();
  const list = compounds ?? MOCK_COMPOUNDS;

  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:test-tube-linear" title="Compound" />

      <div className="space-y-3">
        {list.map((compound) => (
          <CompoundRow
            key={compound.id}
            compound={compound}
            selected={selectedId === Number(compound.id)}
            onSelect={() => onSelect(Number(compound.id))}
          />
        ))}
      </div>

      <p className="text-[10px] text-zinc-500 mt-3">
        Try Tirzepatide (trial curve) vs BPC-157 (void). Age 10 → excluded.
      </p>
    </Panel>
  );
}
