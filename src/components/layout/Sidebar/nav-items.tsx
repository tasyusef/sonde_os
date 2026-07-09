import { type ReactNode } from "react";
import {
  Network,
  TrendingUp,
  Palette,
  LayoutDashboard,
  Brain,
  FlaskConical,
  Sparkles,
  CreditCard,
  BookOpen,
  Info,
  HelpCircle,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Explorer — primary public pages.
 *
 * No "Home" / "Landing" entry on purpose. The landing page lives at
 * `/` and is the marketing surface — the sidebar nav is for the
 * data-rich app pages users actually work in. The Sonde logo at the
 * top of the sidebar (and in the mobile header / footer) is the
 * affordance back to the landing. */
export const navItems: NavItem[] = [
  {
    href: "/network",
    label: "Network",
    icon: <Network size={20} />,
  },
  {
    href: "/markets",
    label: "Markets",
    icon: <TrendingUp size={20} />,
  },
  {
    href: "/nft",
    label: "NFTs",
    icon: <Palette size={20} />,
  },
];

/** Portfolio — personal command center (holdings, PnL, activity, alerts) */
export const dashboardItem: NavItem = {
  href: "/portfolio",
  label: "Portfolio",
  icon: <LayoutDashboard size={20} />,
};

/** Ask the Ledger — natural-language XRPL queries (Pro) */
export const askItem: NavItem = {
  href: "/asktheledger",
  label: "Ask",
  icon: <Sparkles size={20} />,
};

/** Smart Money — leaderboard, wallet details, trade feed */
export const smartMoneyItem: NavItem = {
  href: "/smart-money",
  label: "Smart Money",
  icon: <Brain size={20} />,
};

/** Research — investigate + graph (was Intelligence) */
export const researchItem: NavItem = {
  href: "/research",
  label: "Research",
  icon: <FlaskConical size={20} />,
};

/** Bottom section — pricing, docs, about, etc. */
export const bottomNavItems: NavItem[] = [
  {
    href: "/pricing",
    label: "Pricing",
    icon: <CreditCard size={20} />,
  },
  {
    href: "/docs",
    label: "Docs",
    icon: <BookOpen size={20} />,
  },
  {
    href: "/about",
    label: "About",
    icon: <Info size={20} />,
  },
  {
    href: "/support",
    label: "Support",
    icon: <HelpCircle size={20} />,
  },
];
