import { Icon } from "@iconify/react";
import { COMPOUNDS } from "../../data/mockSimulation";
import { cn } from "../../lib/cn";
import { getTierBadge } from "../../lib/badges";
import type { Compound } from "../../types/simulation";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";

type CocktailMixerCardProps = {
  compounds?: Compound[];
  selectedId: string;
  onSelect: (id: string) => void;
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

export function CocktailMixerCard({
  compounds = COMPOUNDS,
  selectedId,
  onSelect,
}: CocktailMixerCardProps) {
  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:test-tube-linear" title="Compound" />

      <div className="space-y-3">
        {compounds.map((compound) => (
          <CompoundRow
            key={compound.id}
            compound={compound}
            selected={selectedId === compound.id}
            onSelect={() => onSelect(compound.id)}
          />
        ))}
      </div>

      <p className="text-[10px] text-zinc-500 mt-3 flex items-start gap-1.5">
        <Icon icon="solar:info-circle-linear" className="text-sm shrink-0 mt-0.5" />
        Try Tirzepatide (trial curve) vs BPC-157 (void). Age 10 → excluded.
      </p>
    </Panel>
  );
}
