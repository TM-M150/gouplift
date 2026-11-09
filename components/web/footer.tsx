import Link from "next/link";
import Logo from "../icons/logo";
import { NewsletterForm } from "./newsletter-form";
import { FooterStartLink } from "./footer-start-link";
import { SOCIAL_LINKS, SUPPORT_EMAIL } from "@/lib/site";

// Only links that go somewhere. A page that doesn't exist yet doesn't get a
// link: add it here once it does.
const footerLinks = [
  {
    name: "Fundraise",
    links: [
      { href: "/fundraisers", label: "Explore Causes" },
      { href: "/pricing", label: "Pricing & Fees" },
    ],
    // First, because it is the main thing people come to do.
    startLink: true,
  },
  {
    name: "Organizers",
    links: [
      { href: "/how-it-works", label: "How It Works" },
      { href: "/trust", label: "Trust & Verification" },
      { href: "/withdrawals", label: "Payout Accounts" },
    ],
  },
  {
    name: "Resources",
    links: [
      { href: "/about", label: "About Us" },
      { href: "/help", label: "Help Center" },
      ...(SUPPORT_EMAIL
        ? [{ href: `mailto:${SUPPORT_EMAIL}`, label: "Contact Support" }]
        : []),
    ],
  },
  {
    name: "Legal",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Use" },
    ],
  },
];

const linkClass =
  "text-muted-foreground hover:text-primary text-sm transition-colors duration-150";

export function Footer() {
  return (
    <footer className="w-full">
      <div className="mx-auto max-w-7xl px-6 pb-16 pt-24">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-full lg:col-span-1">
            <Link href="/" aria-label="go home">
              <Logo width={40} height={40} className="h-10 w-10" />
            </Link>
          </div>

          {footerLinks.map((group) => (
            <div key={group.name} className="col-span-1">
              <span className="text-sm font-semibold">{group.name}</span>
              <ul className="mt-4 space-y-3">
                {group.startLink && (
                  <li>
                    <FooterStartLink className={linkClass} />
                  </li>
                )}
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="relative w-full max-w-sm">
            <NewsletterForm />
          </div>

          {SOCIAL_LINKS.length > 0 && (
            <div>
              <span className="text-sm font-semibold">Community</span>
              <ul className="mt-4 space-y-3">
                {SOCIAL_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-16 border-t border-border/40 pt-8">
          <span className="text-muted-foreground text-sm">
            &copy; GoUplift {new Date().getFullYear()}
          </span>
        </div>
      </div>
    </footer>
  );
}
