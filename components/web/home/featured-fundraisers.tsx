import {
  FundraiserCard,
  type FundraiserCardData,
} from "@/components/web/fundraiser/fundraiser-card";

/** Renders nothing when there is nothing real to show. */
export function FeaturedFundraisers({
  fundraisers,
}: {
  fundraisers: FundraiserCardData[];
}) {
  if (fundraisers.length === 0) return null;

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {fundraisers.map((fundraiser) => (
        <FundraiserCard key={fundraiser._id} fundraiser={fundraiser} />
      ))}
    </div>
  );
}
