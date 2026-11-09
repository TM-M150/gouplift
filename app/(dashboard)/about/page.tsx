import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_FEE_RATE } from "@/convex/lib/constants";
import { InfoCta, InfoPage, InfoSection } from "@/components/web/info/info-page";
import { SHARE_IMAGE, SITE_URL } from "@/lib/site";

const TITLE = "About GoUplift";
const DESCRIPTION =
  "GoUplift is a crowdfunding platform for Kenya. Individuals and organizations raise money for what matters, and supporters give by M-Pesa, Airtel Money, card or PayPal.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/about`,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

const feePercent = Number((PLATFORM_FEE_RATE * 100).toFixed(2));

export default function AboutPage() {
  return (
    <InfoPage
      title="About GoUplift"
      lead="GoUplift is a crowdfunding platform built for Kenya. People and organizations raise money for what matters to them, and the people around them can help from wherever they are."
    >
      <InfoSection title="What we do">
        <p>
          Anyone can start a fundraiser for themselves, for someone else or for
          an organization: a medical bill, school fees, a funeral, a community
          harambee, a rescue shelter. Supporters give in Kenyan shillings
          through SasaPay, using M-Pesa, Airtel Money, a SasaPay wallet or a
          card, or in US dollars through PayPal. That includes relatives and
          friends abroad.
        </p>
      </InfoSection>

      <InfoSection title="Who it is for">
        <p>
          Individuals raising money for themselves or someone close to them, and
          organizations such as registered companies, NGOs, societies, trusts
          and self-help groups. Organizations can run several fundraisers under
          their own profile.
        </p>
      </InfoSection>

      <InfoSection title="How GoUplift earns">
        <p>
          GoUplift is a for-profit company. We earn through a {feePercent}%
          platform fee on each donation, and we don&apos;t charge to start a
          fundraiser. The details are on the{" "}
          <Link href="/pricing">Pricing &amp; Fees</Link> page.
        </p>
      </InfoSection>

      <InfoSection title="Trust comes first">
        <p>
          Money moves to people we have checked. Read how we do it on the{" "}
          <Link href="/trust">Trust &amp; Verification</Link> page.
        </p>
      </InfoSection>

      <InfoCta />
    </InfoPage>
  );
}
