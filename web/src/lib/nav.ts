import { CalendarClock, CreditCard, HandCoins, History, Home, LineChart, Send, Users, WalletCards, type LucideIcon } from "lucide-react";

/**
 * Navigation and quick actions are rendered FROM THIS ARRAY, never hard-coded
 * into a layout. The build phase gates what appears.
 *
 * The rule this enforces (docs/frontend-screens.md): never ship a tab or an
 * action pointing at a feature that has not been built. A disabled control must
 * mean "not allowed for this transfer", never "we ran out of time".
 *
 * To turn a feature on, flip its `shipped` to true once the screen and its
 * endpoint both exist. Nothing else needs editing.
 */

export interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  shipped: boolean;
  /** For the record: which build phase turns this on. */
  phase: string;
}

export const TABS: NavEntry[] = [
  { href: "/", label: "Home", icon: Home, shipped: true, phase: "Phase 3" },
  { href: "/history", label: "History", icon: History, shipped: true, phase: "Phase 4" },
  { href: "/outlook", label: "Outlook", icon: LineChart, shipped: true, phase: "Financial understanding" },
  { href: "/requests", label: "Requests", icon: HandCoins, shipped: true, phase: "Phase 7" },
  { href: "/smart-wallet", label: "Cash", icon: WalletCards, shipped: true, phase: "Smart Wallet" },
];

export const QUICK_ACTIONS: NavEntry[] = [
  { href: "/send", label: "Send", icon: Send, shipped: true, phase: "Phase 3" },
  { href: "/groups", label: "Split & settle", icon: Users, shipped: true, phase: "Smart Group Settlement" },
  { href: "/scheduled", label: "Schedule", icon: CalendarClock, shipped: true, phase: "Phase 12" },
  { href: "/wallet", label: "Account card", icon: CreditCard, shipped: true, phase: "User account" },
];

export const shippedTabs = () => TABS.filter((t) => t.shipped);
export const shippedQuickActions = () => QUICK_ACTIONS.filter((a) => a.shipped);
