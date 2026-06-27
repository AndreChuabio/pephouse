import type { NavItem } from "../types/navigation";

export const PLATFORM_NAV: NavItem[] = [
  { label: "Cellar", icon: "solar:database-linear", to: "/explorer" },
  { label: "Simulation [old]", icon: "solar:chart-2-linear", to: "/simulation-arena" },
  { label: "Studio", icon: "solar:widget-5-linear", to: "/simulation-2" },
  { label: "Galleria", icon: "solar:users-group-two-rounded-linear", to: "/digital-twin" },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: "Configuration", icon: "solar:settings-linear", to: "#" },
];
