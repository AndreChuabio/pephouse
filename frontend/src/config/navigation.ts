import type { NavItem } from "../types/navigation";

export const PLATFORM_NAV: NavItem[] = [
  { label: "Cellar", icon: "solar:database-linear", to: "/explorer" },
  { label: "Studio", icon: "solar:widget-5-linear", to: "/simulation-2" },
  { label: "Galleria", icon: "solar:users-group-two-rounded-linear", to: "/digital-twin" },
  { label: "Consult", icon: "solar:videocamera-record-linear", to: "/consult" },
];
// "Simulation [old]" (/simulation-arena) hidden from nav -- superseded by Studio.
// Route still mounted in App.tsx so the URL isn't broken.

export const SETTINGS_NAV: NavItem[] = [
  { label: "Configuration", icon: "solar:settings-linear", to: "#" },
];
