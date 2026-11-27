import { HomeSection, SectionHeading } from "@/components/web/home/section";

// The methods /help lists: shillings through SasaPay, dollars through PayPal.
// Names only: the logos belong to the companies behind them.
const GROUPS = [
  {
    title: "In Kenyan shillings, through SasaPay",
    methods: ["M-Pesa", "Airtel Money", "SasaPay wallet", "Card"],
  },
  {
    title: "In US dollars",
    methods: ["PayPal"],
  },
];

export function WaysToGive() {
  return (
    <HomeSection labelledBy="give-title">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <SectionHeading
          id="give-title"
          title="Give the way you already pay"
          lead="Supporters don't need an account. They choose an amount, pay, and get a receipt by email."
        />

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-3xl border border-primary/10 p-6"
            >
              <p className="text-sm text-primary/70">{group.title}</p>
              <ul className="mt-4 flex flex-wrap gap-2.5">
                {group.methods.map((method) => (
                  <li
                    key={method}
                    className="rounded-full bg-mint px-5 py-2.5 text-base font-medium"
                  >
                    {method}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </HomeSection>
  );
}
