const kes = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const kesCompact = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  notation: "compact",
  maximumFractionDigits: 1,
});

const count = new Intl.NumberFormat("en-KE");

function formatKes(amount: number) {
  return amount >= 1_000_000 ? kesCompact.format(amount) : kes.format(amount);
}

export interface PlatformStatsData {
  totalRaisedKes: number;
  totalDonations: number;
  fundraisersLaunched: number;
}

/**
 * Real totals from the platformStats row, drawn for the bottom of the forest
 * hero. A figure only shows when it is above zero, and the whole strip stays
 * hidden until something has been raised, so a new platform never advertises
 * "0".
 */
export function PlatformStats({ stats }: { stats: PlatformStatsData | null }) {
  if (!stats || stats.totalRaisedKes <= 0) return null;

  const items = [
    { value: formatKes(stats.totalRaisedKes), label: "raised on GoUplift" },
    stats.totalDonations > 0 && {
      value: count.format(stats.totalDonations),
      label: stats.totalDonations === 1 ? "donation made" : "donations made",
    },
    stats.fundraisersLaunched > 0 && {
      value: count.format(stats.fundraisersLaunched),
      label:
        stats.fundraisersLaunched === 1
          ? "fundraiser launched"
          : "fundraisers launched",
    },
  ].filter((item) => item !== false);

  return (
    <div className="mx-auto max-w-7xl px-6">
      <dl className="grid gap-6 border-t border-white/15 py-8 sm:grid-cols-3 sm:gap-8 sm:py-10">
        {items.map((item) => (
          // The label comes first in the markup, as a description list needs,
          // and the figure is shown above it.
          <div key={item.label} className="flex flex-col-reverse gap-1">
            <dt className="text-white/70">{item.label}</dt>
            <dd className="text-4xl font-semibold tabular-nums tracking-tight text-secondary md:text-5xl">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
