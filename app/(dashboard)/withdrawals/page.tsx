import type { Metadata } from "next";
import Link from "next/link";
import { InfoCta, InfoPage, InfoSection } from "@/components/web/info/info-page";
import {
  MAX_OPEN_PAYOUT_ACCOUNTS,
  PAYOUT_ACCOUNT_CHANGE_HOLD_MS,
  PAYOUT_METHOD_LABELS,
} from "@/lib/payout-accounts";
import { tierPayoutLimitKes } from "@/lib/kyc";
import { MIN_PAYOUT_KES, PAYPAL_SETTLEMENT_DELAY_DAYS } from "@/lib/payouts";
import { SHARE_IMAGE, SITE_URL } from "@/lib/site";

const TITLE = "Payout Accounts | GoUplift";
const DESCRIPTION =
  "How GoUplift fundraisers are paid: how a withdrawal works, the M-Pesa and bank accounts you can add, how they are checked, and the limits that come with each verification level.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/withdrawals` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/withdrawals`,
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

// From the same constant the payout code uses, so the page can't drift.
const PAYOUT_ACCOUNT_CHANGE_HOLD_HOURS = Math.round(
  PAYOUT_ACCOUNT_CHANGE_HOLD_MS / (60 * 60 * 1000),
);

export default function WithdrawalsPage() {
  return (
    <InfoPage
      title="Payout accounts and limits"
      lead="Before you can be paid, you tell us where the money should go and we check that the account is the right one."
    >
      <InfoSection title="How a withdrawal works">
        <ol>
          <li>
            Open your <Link href="/payouts#withdraw">payouts page</Link> and
            choose how much to withdraw, from {kes(MIN_PAYOUT_KES)} up to what
            is ready.
          </li>
          <li>
            We review the request. Until then the amount is set aside for you,
            and you can cancel the request.
          </li>
          <li>
            Once it is approved we send the money to your payout account. You
            will see the M-Pesa code or bank reference, and exactly what
            reached you.
          </li>
        </ol>
        <p>
          {`Donations paid by M-Pesa, Airtel Money, SasaPay or card are ready to withdraw straight away. Donations paid through PayPal become ready ${PAYPAL_SETTLEMENT_DELAY_DAYS} days after they arrive.`}
        </p>
        <p>
          You can have one withdrawal in progress at a time. Any transfer charge
          from the mobile network or bank comes off the amount you withdraw.
        </p>
      </InfoSection>

      <InfoSection title="Where you can be paid">
        <ul>
          <li>{PAYOUT_METHOD_LABELS.MPESA}</li>
          <li>{PAYOUT_METHOD_LABELS.BANK}</li>
        </ul>
        <p>
          The account should be in your name, or your organization&apos;s. It
          can also belong to someone else, like a hospital or a school, if you
          tell us why. You can have up to {MAX_OPEN_PAYOUT_ACCOUNTS} accounts
          at a time.
        </p>
      </InfoSection>

      <InfoSection title="How accounts are checked">
        <p>
          At Level 1, payouts go to the mobile number you confirmed when you
          verified. It is ready straight away, and it is the only account you
          can use until you reach Level 2. From Level 2 you can add another
          M-Pesa number or a bank account, with proof that it is yours (or the
          beneficiary&apos;s), and our team reviews it before it can be used.
          An organization can add accounts once it has been verified.
        </p>
        <p>
          If you change your payout account, payouts pause for{" "}
          {PAYOUT_ACCOUNT_CHANGE_HOLD_HOURS} hours after the change, so the real
          owner has time to notice and tell us. You can add and manage your
          accounts from your <Link href="/payouts">payouts page</Link> once you
          are signed in.
        </p>
      </InfoSection>

      <InfoSection title="Limits by verification level">
        <ul>
          <li>Not verified: nothing can be paid out.</li>
          <li>Level 1: up to {kes(tierPayoutLimitKes(1))} in total.</li>
          <li>Level 2: up to {kes(tierPayoutLimitKes(2))} in total.</li>
          <li>Above Level 2: reviewed individually by our compliance team.</li>
        </ul>
        <p>
          See <Link href="/trust">Trust &amp; Verification</Link> for what each
          level needs.
        </p>
      </InfoSection>

      <InfoCta />
    </InfoPage>
  );
}
