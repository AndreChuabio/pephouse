import { Icon } from "@iconify/react";
import { MOCK_COMPOUNDS } from "../../data/mockSimulation";
import { useCompounds } from "../../hooks/useCompounds";
import { getTierBadge } from "../../lib/badges";
import type { Compound } from "../../types/simulation";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";
import { SliderTrack } from "../ui/SliderTrack";

type CompoundRowProps = {
  compound: Compound;
};

function CompoundRow({ compound }: CompoundRowProps) {
  const badge = getTierBadge(compound.tier);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-sm font-medium text-zinc-200 flex items-center gap-2">
            {compound.name}
            <span className={badge.className}>{badge.label}</span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{compound.description}</p>
        </div>
        <button type="button" aria-label={`Remove ${compound.name}`} className="text-zinc-600 hover:text-red-400 transition-colors">
          <Icon icon="solar:trash-bin-trash-linear" className="text-sm" />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="text-xs font-medium text-zinc-500">Dosage</span>
          <span className="text-xs text-zinc-300 font-mono">{compound.dosage}</span>
        </div>
        <SliderTrack percent={compound.dosagePercent} />
      </div>
    </div>
  );
}

export function CocktailMixerCard() {
  // Real compounds from Supabase; falls back to mock only while the request is in flight.
  const { compounds } = useCompounds();
  const list = compounds ?? MOCK_COMPOUNDS;

  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:test-tube-linear" title="Cocktail Formulation" />

      <div className="space-y-3">
        {list.map((compound) => (
          <CompoundRow key={compound.id} compound={compound} />
        ))}
      </div>

      <button
        type="button"
        className="w-full mt-4 py-2 border border-dashed border-zinc-700 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:border-zinc-500 hover:bg-zinc-800/30 transition-all flex items-center justify-center gap-2"
      >
        <Icon icon="solar:add-circle-linear" className="text-base" />
        Add Compound
      </button>
    </Panel>
  );
}
