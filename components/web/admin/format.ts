const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

// "+" means the query hit its cap, so the real number is at least this.
export function formatCount(count: number, capped = false) {
  return count.toLocaleString("en-KE") + (capped ? "+" : "");
}

export function formatKes(amount: number, capped = false) {
  return kes.format(amount) + (capped ? "+" : "");
}
