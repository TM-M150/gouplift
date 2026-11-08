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
 * Real totals from the platformStats row. A figure only shows when it is
 * above zero, and the whole strip stays hidden until something has been
 * raised, so a new platform never advertises "0".
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
    <dl className="mt-12 grid gap-8 border-t pt-8 sm:grid-cols-3 md:mt-16">
      {items.map((item) => (
        <div key={item.label}>
          <dd className="text-4xl font-medium tracking-tight">{item.value}</dd>
          <dt className="text-muted-foreground mt-1">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}
