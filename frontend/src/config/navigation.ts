import type { NavItem } from "../types/navigation";

export const PLATFORM_NAV: NavItem[] = [
  { label: "Database Explorer", icon: "solar:database-linear", to: "/explorer" },
  { label: "Simulation Arena", icon: "solar:chart-2-linear", to: "/simulation-arena" },
  { label: "Digital Twins", icon: "solar:users-group-two-rounded-linear", to: "#" },
];

export const SETTINGS_NAV: NavItem[] = [
  { label: "Configuration", icon: "solar:settings-linear", to: "#" },
];
