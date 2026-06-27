import type { PatientInput } from "../../types/simulation";
import { Panel } from "../ui/Panel";
import { PanelHeader } from "../ui/PanelHeader";
import { SliderTrack } from "../ui/SliderTrack";

type DemographicsCardProps = {
  patient: PatientInput;
  onChange: (patient: PatientInput) => void;
};

export function DemographicsCard({ patient, onChange }: DemographicsCardProps) {
  const weightPercent = ((patient.weightKg - 60) / 80) * 100;

  return (
    <Panel className="p-5">
      <PanelHeader icon="solar:user-linear" title="Base Demographic (Twin)" />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500" htmlFor="age">
            Age
          </label>
          <select
            id="age"
            value={patient.age}
            onChange={(e) => onChange({ ...patient, age: Number(e.target.value) })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-2 text-sm text-zinc-200"
          >
            <option value={35}>35 years</option>
            <option value={55}>55 years</option>
            <option value={10}>10 years</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500" htmlFor="sex">
            Sex
          </label>
          <select
            id="sex"
            value={patient.sex}
            onChange={(e) => onChange({ ...patient, sex: e.target.value as "M" | "F" })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-2 text-sm text-zinc-200"
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </div>

        <div className="col-span-2 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-xs font-medium text-zinc-500">Weight (baseline)</span>
            <span className="text-xs text-zinc-400 font-mono">{patient.weightKg} kg</span>
          </div>
          <input
            type="range"
            min={60}
            max={140}
            value={patient.weightKg}
            onChange={(e) => onChange({ ...patient, weightKg: Number(e.target.value) })}
            className="w-full accent-blue-500"
          />
          <SliderTrack percent={weightPercent} size="md" accent="neutral" />
        </div>
      </div>
    </Panel>
  );
}
