import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { HomeSection, SectionHeading } from "@/components/web/home/section";

// Short versions of answers on /help, where the full ones live. Plain
// <details> elements, so they open and close with no script.
function questionsFor(feePercent: number) {
  return [
    {
      question: "Do I need an account to donate?",
      answer:
        "No. You can donate without signing in. You'll be asked for an email address so we can send your receipt.",
    },
    {
      question: "How can I pay?",
      answer:
        "In Kenyan shillings through SasaPay, using M-Pesa, Airtel Money, a SasaPay wallet or a card. Or in US dollars through PayPal.",
    },
    {
      question: "What does GoUplift charge?",
      answer: `Starting a fundraiser is free. GoUplift takes a ${feePercent}% platform fee on each donation. The fee comes out of the donation, so supporters aren't charged anything extra by GoUplift. Your mobile network or payment provider may apply its own charges.`,
    },
    {
      question: "Can I start a fundraiser before I'm verified?",
      answer:
        "Yes. Your fundraiser goes live as soon as you publish it and you can raise funds while you wait, but nothing can be paid out to you until you are verified.",
    },
    {
      question: "How do I get the money I've raised?",
      answer:
        "Add a payout account, either an M-Pesa number or a bank account, then ask for a withdrawal. We review each request, then send the money.",
    },
    {
      question: "What can I raise money for?",
      answer:
        "Medical bills, education, emergencies, funerals, community harambees, business startups, sports, creative arts, animal welfare, the environment, disaster relief and nonprofit work. Anything unlawful is not allowed.",
    },
  ];
}

export function HomeFaq({ feePercent }: { feePercent: number }) {
  return (
    <HomeSection labelledBy="faq-title">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <SectionHeading
            id="faq-title"
            title="Questions people ask first"
            lead="Short answers here. The Help centre has the rest."
          />
          <Link
            href="/help"
            className="mt-6 inline-block text-lg font-medium underline underline-offset-4 hover:text-primary/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            Open the Help centre
          </Link>
        </div>

        <div className="border-t border-primary/15">
          {questionsFor(feePercent).map((item) => (
            <details
              key={item.question}
              className="group border-b border-primary/15"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 text-primary/70 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="max-w-2xl text-pretty pb-6 text-primary/70">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
