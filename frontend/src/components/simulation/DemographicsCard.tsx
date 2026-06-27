import { DEMOGRAPHICS } from "../../data/mockSimulation";
import { FakeSelect } from "../ui/FakeSelect";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";
import { SliderTrack } from "../ui/SliderTrack";

export function DemographicsCard() {
  const { ageRange, sex, weightKg, weightPercent, extrapolateComorbidities } = DEMOGRAPHICS;

  return (
    <Panel className="p-5">
      <PanelHeader
        icon="solar:user-linear"
        title="Base Demographic (Twin)"
        action={
          <button type="button" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            Import EHR
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <FakeSelect label="Age Range" value={ageRange} />
        <FakeSelect label="Sex" value={sex} />

        <div className="col-span-2 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-xs font-medium text-zinc-500">Weight (Baseline)</span>
            <span className="text-xs text-zinc-400 font-mono">{weightKg} kg</span>
          </div>
          <SliderTrack percent={weightPercent} size="md" accent="neutral" />
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-zinc-800/60 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-300">Extrapolate Co-morbidities</p>
          <p className="text-xs text-zinc-500">Based on age/weight cohort</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={extrapolateComorbidities}
          aria-label="Extrapolate co-morbidities"
          className={`w-8 h-[18px] rounded-full relative flex items-center px-0.5 transition-colors ${
            extrapolateComorbidities ? "bg-blue-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${
              extrapolateComorbidities ? "translate-x-[14px]" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </Panel>
  );
}
