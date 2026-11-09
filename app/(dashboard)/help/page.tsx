import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { PLATFORM_FEE_RATE } from "@/convex/lib/constants";
import { InfoCta, InfoPage } from "@/components/web/info/info-page";
import { SHARE_IMAGE, SITE_URL, SUPPORT_EMAIL } from "@/lib/site";

const TITLE = "Help Center | GoUplift";
const DESCRIPTION =
  "Answers to common questions about donating on GoUplift, starting a fundraiser, fees, verification and payouts.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/help` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/help`,
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

const faqs: Array<{ question: string; answer: React.ReactNode }> = [
  {
    question: "Do I need an account to donate?",
    answer: (
      <p>
        No. You can donate without signing in. You&apos;ll be asked for an email
        address so we can send your receipt.
      </p>
    ),
  },
  {
    question: "How can I pay?",
    answer: (
      <p>
        In Kenyan shillings through SasaPay, using M-Pesa, Airtel Money, a
        SasaPay wallet or a card. Or in US dollars through PayPal.
      </p>
    ),
  },
  {
    question: "Does GoUplift charge donors?",
    answer: (
      <p>
        GoUplift doesn&apos;t add anything to your donation. Its {feePercent}%
        platform fee comes out of the donation. Your mobile network or payment
        provider may apply its own charges. See{" "}
        <Link href="/pricing">Pricing &amp; Fees</Link>.
      </p>
    ),
  },
  {
    question: "What happens to the message I write when I donate?",
    answer: (
      <>
        <p>It isn&apos;t shown publicly.</p>
        <p>
          If you are signed in and have completed identity verification, you can
          tick a box to offer your message as a testimonial. Our team reads it
          before it appears on the homepage, under your first name and the
          initial of your last name. You can withdraw it any time from your
          profile.
        </p>
      </>
    ),
  },
  {
    question: "What can I raise money for?",
    answer: (
      <p>
        Medical bills, education, emergencies, funerals, community harambees,
        business startups, sports, creative arts, animal welfare, the
        environment, disaster relief and nonprofit work. Anything unlawful is
        not allowed. See the categories on the{" "}
        <Link href="/fundraisers">fundraisers page</Link>.
      </p>
    ),
  },
  {
    question: "Can I start a fundraiser before I'm verified?",
    answer: (
      <p>
        Yes. You can raise funds while you wait, but nothing can be paid out to
        you until you are verified. See{" "}
        <Link href="/trust">Trust &amp; Verification</Link>.
      </p>
    ),
  },
  {
    question: "How do I get verified?",
    answer: (
      <p>
        Sign in and open the <Link href="/verification">verification page</Link>.
        It shows what each level needs and where your application stands.
      </p>
    ),
  },
  {
    question: "How do I tell you where to send the money?",
    answer: (
      <p>
        Add a payout account, an M-Pesa number or a bank account, from your{" "}
        <Link href="/payouts">payouts page</Link>. See{" "}
        <Link href="/withdrawals">Payout accounts</Link> for how they are
        checked.
      </p>
    ),
  },
  {
    question: "Can an organization raise money?",
    answer: (
      <p>
        Yes. <Link href="/organizations/new">Create an organization</Link>,
        submit its verification documents and run fundraisers under its name.
      </p>
    ),
  },
];

export default function HelpPage() {
  return (
    <InfoPage
      title="Help center"
      lead="Quick answers about donating, starting a fundraiser, fees, verification and payouts."
    >
      <div className="divide-y rounded-2xl border">
        {faqs.map((item) => (
          <details key={item.question} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="mt-3 space-y-3 leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2">
              {item.answer}
            </div>
          </details>
        ))}
      </div>

      {SUPPORT_EMAIL && (
        <p className="text-muted-foreground">
          Still stuck? Email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-foreground underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      )}

      <InfoCta />
    </InfoPage>
  );
}
