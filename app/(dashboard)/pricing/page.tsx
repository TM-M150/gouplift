import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_FEE_RATE } from "@/convex/lib/constants";
import { InfoCta, InfoPage, InfoSection } from "@/components/web/info/info-page";
import { SHARE_IMAGE, SITE_URL } from "@/lib/site";

const TITLE = "Pricing & Fees | GoUplift";
const DESCRIPTION =
  "Starting a GoUplift fundraiser is free. GoUplift charges a platform fee on each donation. Here is exactly how it works.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/pricing` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/pricing`,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

// Worked from the same constant the donation code uses, so this page can't
// say one thing while a donation does another.
const feePercent = Number((PLATFORM_FEE_RATE * 100).toFixed(2));
const EXAMPLE_DONATION = 1000;
const exampleFee = Math.round(EXAMPLE_DONATION * PLATFORM_FEE_RATE * 100) / 100;
const exampleNet = EXAMPLE_DONATION - exampleFee;

const kes = (amount: number) =>
  `KES ${amount.toLocaleString("en-KE", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

export default function PricingPage() {
  return (
    <InfoPage
      title="Pricing and fees"
      lead="It costs nothing to start a fundraiser. GoUplift is paid by a platform fee on each donation, and nothing else."
    >
      <InfoSection title="The platform fee">
        <p>
          GoUplift charges a <strong>{feePercent}% platform fee</strong>{" "}
          on each donation. The fee comes out of the donation, so the fundraiser
          receives the rest and supporters aren&apos;t charged anything extra
          by GoUplift.
        </p>
        <p>
          For example, on a donation of {kes(EXAMPLE_DONATION)}, the fee is{" "}
          {kes(exampleFee)} and {kes(exampleNet)} goes to the fundraiser.
        </p>
      </InfoSection>

      <InfoSection title="What the fundraiser page shows">
        <p>
          The total raised on a fundraiser page is the full amount donated,
          before the platform fee. What the fundraiser receives is that amount
          minus the fee.
        </p>
      </InfoSection>

      <InfoSection title="Donations in US dollars">
        <p>
          Donations made through PayPal are in US dollars. They are converted
          to Kenyan shillings, using a recent exchange rate, for the
          fundraiser&apos;s total.
        </p>
      </InfoSection>

      <InfoSection title="Other charges">
        <p>
          Your mobile network or payment provider may apply its own charges to
          payments. Our <Link href="/terms">Terms of Use</Link> explain how
          that works.
        </p>
      </InfoSection>

      <InfoCta />
    </InfoPage>
  );
}
