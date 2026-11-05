import {
  Building2,
  Heart,
  LayoutDashboard,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  ready: boolean; // flip to true as each page gets built
}

export const adminNav: AdminNavItem[] = [
  { title: "Overview", href: "/admin", icon: LayoutDashboard, ready: true },
  {
    title: "Organizations",
    href: "/admin/organizations",
    icon: Building2,
    ready: true,
  },
  {
    title: "Verification",
    href: "/admin/verification",
    icon: ShieldCheck,
    ready: true,
  },
  {
    title: "Fundraisers",
    href: "/admin/fundraisers",
    icon: Heart,
    ready: false,
  },
  { title: "Payouts", href: "/admin/payouts", icon: Wallet, ready: false },
  { title: "Users", href: "/admin/users", icon: Users, ready: false },
];
