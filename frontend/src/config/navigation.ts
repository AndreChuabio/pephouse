import type { NavItem } from "../types/navigation";

// The product is the evidence, the sources, and the member's own data.
//
// "Galleria" (/digital-twin) is back on the nav: it holds the bloodwork upload,
// lab extraction, and profile — "your real biomarkers", half the landing-page
// promise. It also contains the Monte Carlo projection, which is the one piece to
// watch: outcome bands for a compound with no completed trials read as a
// precision the evidence does not support. The page returns distribution_void
// honestly in that case, but the visual still invites over-reading.
//
// "Studio" (/simulation-2) is the standalone Monte Carlo builder. It stays off
// the nav: it is the projection with none of the bloodwork value, so it is the
// pure false-precision surface. Route stays mounted so no existing link breaks.
//
// "Consult" (/consult) is the Tavus video agent. Off the nav, and its backend is
// disabled unless CONSULT_ENABLED is set, because CVI bills real money per
// wall-clock minute and no few-dollar product can carry that cost.
export const PLATFORM_NAV: NavItem[] = [
  { label: "Cellar", icon: "solar:database-linear", to: "/explorer" },
  { label: "Sources", icon: "solar:box-linear", to: "/vendors" },
  { label: "Stack report", icon: "solar:clipboard-list-linear", to: "/report" },
  { label: "Galleria", icon: "solar:heart-pulse-linear", to: "/digital-twin" },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: "Configuration", icon: "solar:settings-linear", to: "/settings" },
];
