// How far along a fundraiser is, worked out in one place so that the page as
// the server first draws it and the page as it keeps itself up to date show
// the same figures.

const wholeShillings = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

/** "Ksh 1,500": whole shillings, written as the rest of the site writes them. */
export function formatKesWhole(amount: number): string {
  return wholeShillings.format(amount);
}

/** Percent of the goal raised, whole, between 0 and 100. */
export function fundraiserProgress(
  amountRaised: number,
  goalAmount: number,
): number {
  if (!(goalAmount > 0)) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((amountRaised / goalAmount) * 100)),
  );
}
