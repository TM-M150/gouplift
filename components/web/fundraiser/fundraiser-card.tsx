import { Card, CardContent } from "@/components/ui/card";
import Image from "next/image";
import Link from "next/link";

const currencyFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

export interface FundraiserCardData {
  _id: string;
  title: string;
  goalAmount: number;
  amountRaised: number;
  donorCount: number;
  location?: string;
  coverImageUrl: string | null;
}

export function FundraiserCard({
  fundraiser,
}: {
  fundraiser: FundraiserCardData;
}) {
  const progress =
    fundraiser.goalAmount > 0
      ? Math.min(
          100,
          Math.round((fundraiser.amountRaised / fundraiser.goalAmount) * 100),
        )
      : 0;

  return (
    <Link href={`/fundraiser/${fundraiser._id}`} className="block h-full">
      <Card className="h-full overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          {fundraiser.coverImageUrl ? (
            <Image
              src={fundraiser.coverImageUrl}
              alt={fundraiser.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/10 text-sm text-muted-foreground">
              No photo
            </div>
          )}
        </div>

        <CardContent className="space-y-3 p-5">
          <div>
            <h3 className="line-clamp-1 text-lg font-semibold">
              {fundraiser.title}
            </h3>
            {fundraiser.location && (
              <p className="text-sm text-muted-foreground">
                {fundraiser.location}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">
                {currencyFormatter.format(fundraiser.amountRaised)}
              </span>
              <span className="text-muted-foreground">
                of {currencyFormatter.format(fundraiser.goalAmount)}
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {fundraiser.donorCount}{" "}
            {fundraiser.donorCount === 1 ? "donor" : "donors"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
