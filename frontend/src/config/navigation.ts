import type { NavItem } from "../types/navigation";

export const PLATFORM_NAV: NavItem[] = [
  { label: "Simulation Arena", icon: "solar:flask-linear", to: "/simulation-arena" },
  { label: "Digital Twins", icon: "solar:users-group-two-rounded-linear", to: "#" },
  { label: "Data Provenance", icon: "solar:database-linear", to: "#" },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: "Configuration", icon: "solar:settings-linear", to: "#" },
];
