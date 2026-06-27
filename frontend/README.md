# PepHouse Frontend

Single-page Simulation Arena UI. Scaffold only — all data is mocked.

## Stack

- React 19 + TypeScript (strict)
- Vite 7
- Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config.*` — utilities only)
- `react-router-dom` v7 (one route today)
- `@iconify/react` for icons (Solar set)

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview
```

## Where things live

```
src/
  pages/SimulationArenaPage.tsx   layout entry point
  components/
    layout/      AppShell, Sidebar, ArenaHeader
    simulation/  one file per card on the page
    ui/          Panel, PanelHeader, SliderTrack, FakeSelect
  data/mockSimulation.ts          ALL displayed values live here
  types/                          shared types (simulation, navigation)
  config/navigation.ts            sidebar items
  hooks/, lib/                    one-liners (useDocumentTitle, cn, badges)
```

## What's real vs. mock

- **Mock:** every number, label, chart bar, and provenance row. Swap by editing `src/data/mockSimulation.ts` or wiring it to an API and replacing the imports.
- **Visual-only (no handlers yet):** Run Simulation, Export Report, Import EHR, Add Compound, compound remove button, slider thumbs, the comorbidities toggle, and the Efficacy/Risk Profile tab on the chart. The toggle reads its state from `DEMOGRAPHICS.extrapolateComorbidities` — it does not flip on click.
- **`FakeSelect`:** named that way on purpose — it's a styled button, not a real `<select>`. Replace when forms get wired up.

## Conventions

- No CSS modules / styled-components — Tailwind classes inline. `cn()` in `src/lib/cn.ts` joins conditional classes.
- Badges (evidence tier, provenance tier) are centralized in `src/lib/badges.ts` so styling stays consistent as tiers are added.
- Sidebar items with `to: "#"` are placeholders; only `/simulation-arena` routes today.
