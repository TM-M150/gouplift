import Link from "next/link";
import { Label } from "../ui/label";
import { Input } from "@base-ui/react";
import { Button } from "../ui/button";
import Logo from "../icons/logo";

const socials = [
  { href: "#", label: "Facebook" },
  { href: "#", label: "Tiktok" },
  { href: "#", label: "Youtube" },
  { href: "#", label: "X / Twitter" },
];

export const footerLinks = [
  {
    name: "Fundraise",
    links: [
      { href: "#", label: "Start a Campaign" },
      { href: "#", label: "Explore Causes" },
      { href: "#", label: "Pricing & Fees" },
      { href: "#", label: "Success Stories" },
    ],
  },
  {
    name: "Organizers",
    links: [
      { href: "#", label: "How It Works" },
      { href: "#", label: "Fundraising Tips" },
      { href: "#", label: "Withdrawal & Payouts" },
      { href: "#", label: "Trust & Verification" },
    ],
  },
  {
    name: "Resources",
    links: [
      { href: "#", label: "About Us" },
      { href: "#", label: "Help Center" },
      { href: "#", label: "Blog & News" },
      { href: "#", label: "Contact Support" },
    ],
  },
  {
    name: "Legal",
    links: [
      { href: "#", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Use" },
      { href: "#", label: "Donor Guarantee" },
      { href: "#", label: "Cookie Policy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="w-full">
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-24">
        {/* Main 5-Column Grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-5">
          {/* Column 1: Logo */}
          <div className="col-span-full lg:col-span-1">
            <Link href="/" aria-label="go home">
              <Logo width={40} height={40} className="h-10 w-10" />
            </Link>
          </div>

          {/* Columns 2-4: Nav Link Groups */}
          {footerLinks.map((linksGroup, index) => (
            <div key={index} className="col-span-1">
              <span className="text-sm font-semibold">{linksGroup.name}</span>
              <ul className="mt-4 space-y-3">
                {linksGroup.links.map((link, linkIdx) => (
                  <li key={linkIdx}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-primary text-sm transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Column 5: Community + Newsletter stacked directly beneath */}
          <div className="col-span-1 flex flex-col justify-between space-y-8">
            <div>
              <span className="text-sm font-semibold">Community</span>
              <ul className="mt-4 space-y-3">
                {socials.map((link, index) => (
                  <li key={index}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-primary text-sm transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Newsletter form directly under Community */}
            <form className="w-full">
              <div className="space-y-2.5">
                <Label className="block text-sm font-semibold" htmlFor="email">
                  Subscribe to our newsletter
                </Label>
                <Input
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Your email"
                  type="email"
                  id="email"
                  required
                  name="email"
                />
              </div>
              <Button type="submit" className="mt-3 w-full" size="sm">
                <span>Subscribe</span>
              </Button>
            </form>
          </div>
        </div>

        {/* Copyright Footer Line */}
        <div className="mt-16 border-t border-border/40 pt-8">
          <span className="text-muted-foreground text-sm">
            &copy; GoupLift {new Date().getFullYear()}
          </span>
        </div>
      </div>
    </footer>
  );
}
