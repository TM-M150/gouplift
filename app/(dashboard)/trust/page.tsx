import type { Metadata } from "next";
import Link from "next/link";
import { InfoCta, InfoPage, InfoSection } from "@/components/web/info/info-page";
import {
  KYC_REVIEW_CHECK_LABELS,
  REQUIRED_KYC_REVIEW_CHECKS,
  tierPayoutLimitKes,
} from "@/lib/kyc";
import { SHARE_IMAGE, SITE_URL } from "@/lib/site";

const TITLE = "Trust & Verification | GoUplift";
const DESCRIPTION =
  "How GoUplift checks the people and organizations that receive money: identity checks for fundraisers, document review for organizations, and verified payout accounts.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/trust` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/trust`,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

const kes = (amount: number) => `KES ${amount.toLocaleString("en-KE")}`;

export default function TrustPage() {
  return (
    <InfoPage
      title="Trust and verification"
      lead="We check everyone who receives money through GoUplift. Here is what that means, so you know what to expect as a fundraiser and what stands behind a fundraiser as a supporter."
    >
      <InfoSection title="Raise first, verify before you are paid">
        <p>
          A fundraiser goes live as soon as it is published. You can raise funds
          while you wait to be verified, but nothing can be paid out to you
          until you are.
        </p>
      </InfoSection>

      <InfoSection id="individuals" title="Verification for individuals">
        <p>
          Verification has levels. Each level is checked by a person on our team
          before it is approved, and each one raises the total we can pay out to
          you.
        </p>
        <ul>
          <li>
            <strong>Level 1: confirm who you are.</strong> Your ID (a National
            ID or passport), a mobile number in your name and what the money is
            for. Up to {kes(tierPayoutLimitKes(1))} in total.
          </li>
          <li>
            <strong>Level 2: back up your campaign.</strong> Evidence for the
            campaign, your KRA PIN and proof of your payout account. Up to{" "}
            {kes(tierPayoutLimitKes(2))} in total.
          </li>
          <li>
            <strong>Above that.</strong> Payouts beyond Level 2 need extra
            checks, and our compliance team reviews each one individually.
          </li>
        </ul>

        <p>Before approving a level, a reviewer confirms that:</p>
        <ul>
          {([1, 2] as const).flatMap((tier) =>
            REQUIRED_KYC_REVIEW_CHECKS[tier].map((check) => (
              <li key={check}>{KYC_REVIEW_CHECK_LABELS[check]}</li>
            )),
          )}
        </ul>
      </InfoSection>

      <InfoSection id="organizations" title="Verification for organizations">
        <p>
          Organizations are reviewed separately. Depending on the kind of
          organization, such as a registered company, an NGO, a society, a trust
          or a self-help group, we ask for its registration documents, a KRA PIN
          certificate, proof of its payout account, and identification for the
          people who own or control it. Our team reviews them, and organizations
          that pass are marked as verified.
        </p>
      </InfoSection>

      <InfoSection title="Verified payout accounts">
        <p>
          Money can only go to a payout account we have verified: in the
          fundraiser&apos;s own name, or a verified beneficiary such as a
          hospital or a school. Read more about{" "}
          <Link href="/withdrawals">payout accounts</Link>.
        </p>
      </InfoSection>

      <InfoSection title="What verification does and doesn't mean">
        <p>
          Verification confirms who is receiving the money. It isn&apos;t a
          guarantee about how a fundraiser will turn out. Give to people and
          causes you trust, and read the fundraiser&apos;s story before you
          donate. See our <Link href="/terms">Terms of Use</Link> for the full
          position.
        </p>
      </InfoSection>

      <InfoCta />
    </InfoPage>
  );
}
