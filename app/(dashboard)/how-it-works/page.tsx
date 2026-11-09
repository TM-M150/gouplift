import type { Metadata } from "next";
import Link from "next/link";
import { InfoCta, InfoPage, InfoSection } from "@/components/web/info/info-page";
import { SHARE_IMAGE, SITE_URL } from "@/lib/site";

const TITLE = "How It Works | GoUplift";
const DESCRIPTION =
  "How a GoUplift fundraiser works: create it, share it, receive donations in Kenyan shillings or US dollars, and get verified to be paid out.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/how-it-works` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/how-it-works`,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

export default function HowItWorksPage() {
  return (
    <InfoPage
      title="How GoUplift works"
      lead="Raise money for yourself, for someone else or for an organization. Supporters give in Kenyan shillings or US dollars, and you follow the total as it grows."
    >
      <InfoSection title="From idea to donations">
        <ol>
          <li>
            <strong>Create your fundraiser.</strong> Make an account, then tell
            your story, set a goal in Kenyan shillings, choose a category and,
            if you like, add a cover photo. Say whether you are raising money
            for yourself, for someone else or for an organization. Your
            fundraiser goes live as soon as you publish it.
          </li>
          <li>
            <strong>Share it.</strong>{" "}
            Every fundraiser has its own page and link. Send it to the people
            who might want to help. Supporters don&apos;t need an account to
            give.
          </li>
          <li>
            <strong>Supporters give.</strong> They can pay in Kenyan shillings
            through SasaPay (M-Pesa, Airtel Money, SasaPay wallet or card), or
            in US dollars through PayPal. The fundraiser page shows how much
            has been raised against the goal and how many donations have been
            made.
          </li>
          <li>
            <strong>Get verified.</strong> You can raise funds while you wait,
            but nothing can be paid out to you until you are verified. See{" "}
            <Link href="/trust">Trust &amp; Verification</Link>.
          </li>
          <li>
            <strong>Add a payout account.</strong> Tell us where your funds
            should go: an M-Pesa number or a bank account. See{" "}
            <Link href="/withdrawals">Payout accounts</Link>.
          </li>
        </ol>
      </InfoSection>

      <InfoSection title="For organizations">
        <p>
          Organizations can create a profile, submit their verification
          documents and run fundraisers under the organization&apos;s name.
          Organizations are reviewed separately from individuals. See{" "}
          <Link href="/trust#organizations">how organizations are verified</Link>.
        </p>
      </InfoSection>

      <InfoSection title="What it costs">
        <p>
          Starting a fundraiser is free. GoUplift takes a small platform fee on
          each donation. The details are on the{" "}
          <Link href="/pricing">Pricing &amp; Fees</Link> page.
        </p>
      </InfoSection>

      <InfoCta />
    </InfoPage>
  );
}
