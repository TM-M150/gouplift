// Decorative pieces for the two homepage panels. They stand in for the stock
// video and photo that used to sit there, say nothing a screen reader needs,
// and carry no numbers about real fundraisers.

// The same suggested amounts as the donation form.
const AMOUNTS = [
  { amount: 500, offset: "0px" },
  { amount: 1000, offset: "36px", highlight: true },
  { amount: 2500, offset: "10px" },
  { amount: 5000, offset: "52px" },
];

/** Gifts of different sizes, stacked: every contribution counts. */
export function AmountSlips() {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 right-0 hidden w-1/2 flex-col items-end justify-center gap-3 pr-8 sm:flex"
    >
      {AMOUNTS.map(({ amount, offset, highlight }) => (
        <div
          key={amount}
          style={{ marginRight: offset }}
          className={
            highlight
              ? "rounded-full bg-[rgb(9,204,96)] px-6 py-2.5 text-xl font-semibold tabular-nums text-[rgb(7,43,25)]"
              : "rounded-full bg-[rgb(7,43,25)] px-6 py-2.5 text-xl font-medium tabular-nums text-white"
          }
        >
          KES {amount.toLocaleString("en-KE")}
        </div>
      ))}
    </div>
  );
}

/** A goal getting closer. A shape only, never a real figure. */
export function GoalRing() {
  return (
    <div aria-hidden className="flex items-center justify-center py-2">
      <div
        className="size-44 rounded-full"
        style={{
          background:
            "conic-gradient(#fff 0 68%, rgb(255 255 255 / 0.25) 68% 100%)",
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 16px), #000 calc(100% - 15px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 16px), #000 calc(100% - 15px))",
        }}
      />
    </div>
  );
}
