import {
  Building2,
  Heart,
  Landmark,
  LayoutDashboard,
  Quote,
  ShieldCheck,
  Undo2,
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
    title: "Payout accounts",
    href: "/admin/payout-accounts",
    icon: Landmark,
    ready: true,
  },
  {
    title: "Testimonials",
    href: "/admin/testimonials",
    icon: Quote,
    ready: true,
  },
  {
    title: "Fundraisers",
    href: "/admin/fundraisers",
    icon: Heart,
    ready: false,
  },
  { title: "Payouts", href: "/admin/payouts", icon: Wallet, ready: true },
  { title: "Refunds", href: "/admin/refunds", icon: Undo2, ready: true },
  { title: "Users", href: "/admin/users", icon: Users, ready: false },
];
