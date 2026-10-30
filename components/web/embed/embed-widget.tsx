import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VerificationBadge } from "@/components/web/organization/verification-badge";
import { cn } from "@/lib/utils";

// Everything below is what gets shown inside an organization's website, so
// links leave the frame: they open GoUplift in a new tab. Payment pages
// can't be shown inside someone else's page, and the donor should see the
// real GoUplift address before paying anyway.

export interface EmbedOrganization {
  slug: string;
  name: string;
  logoUrl: string | null;
}

export interface EmbedFundraiser {
  _id: string;
  title: string;
  currency: "KES" | "USD";
  goalAmount: number;
  amountRaised: number;
  donorCount: number;
  location: string | null;
  coverImageUrl: string | null;
}

function formatMoney(amount: number, currency: "KES" | "USD") {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

const externalLink = { target: "_blank", rel: "noopener" } as const;

export function EmbedMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function EmbedWidget({
  organization,
  fundraisers,
}: {
  organization: EmbedOrganization;
  fundraisers: EmbedFundraiser[];
}) {
  return (
    <div className="space-y-4">
      {/* Wraps instead of squeezing: on a phone the link drops to its own
          line rather than cutting the organization's name down to "Hope K…". */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-9">
            <AvatarImage
              src={organization.logoUrl ?? undefined}
              alt={organization.name}
            />
            <AvatarFallback className="text-xs font-medium">
              {initials(organization.name)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate font-semibold">{organization.name}</span>
          <VerificationBadge status="VERIFIED" />
        </div>
        <a
          href={`/organizations/${organization.slug}`}
          {...externalLink}
          className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          View on GoUplift
        </a>
      </header>

      {fundraisers.length === 0 ? (
        <EmbedMessage>No active fundraisers right now.</EmbedMessage>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {fundraisers.map((fundraiser) => {
            const progress =
              fundraiser.goalAmount > 0
                ? Math.min(
                    100,
                    Math.round(
                      (fundraiser.amountRaised / fundraiser.goalAmount) * 100,
                    ),
                  )
                : 0;

            return (
              <li key={fundraiser._id}>
                <Card className="flex h-full flex-col overflow-hidden p-0">
                  <div className="relative aspect-video w-full overflow-hidden bg-muted">
                    {fundraiser.coverImageUrl ? (
                      // Organizations can point at images on any host, which
                      // next/image's optimizer would refuse, so serve as-is.
                      <Image
                        src={fundraiser.coverImageUrl}
                        alt=""
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 100vw, 320px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>

                  <CardContent className="flex flex-1 flex-col gap-3 p-4">
                    <div className="space-y-0.5">
                      {/* Two lines are reserved so cards line up. The reserve
                          must be exactly two line-heights (2lh): any taller and
                          line-clamp's clipped box lets the top of a third line
                          show through under the ellipsis. */}
                      <h3 className="line-clamp-2 min-h-[2lh] font-semibold leading-snug">
                        {fundraiser.title}
                      </h3>
                      {fundraiser.location && (
                        <p className="text-sm text-muted-foreground">
                          {fundraiser.location}
                        </p>
                      )}
                    </div>

                    {/* Progress and button sit together at the bottom, so
                        they line up across cards whether or not a card has a
                        location line. */}
                    <div className="mt-auto flex flex-col gap-3">
                      <div className="space-y-1.5">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-medium">
                            {formatMoney(
                              fundraiser.amountRaised,
                              fundraiser.currency,
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            of{" "}
                            {formatMoney(
                              fundraiser.goalAmount,
                              fundraiser.currency,
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {fundraiser.donorCount}{" "}
                          {fundraiser.donorCount === 1 ? "donor" : "donors"}
                        </p>
                      </div>

                      <a
                        href={`/fundraiser/${fundraiser._id}?source=embed`}
                        {...externalLink}
                        className={cn(buttonVariants({ size: "lg" }), "w-full")}
                      >
                        Donate
                      </a>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="text-center text-xs text-muted-foreground">
        <Link
          href="/"
          {...externalLink}
          className="underline-offset-4 hover:underline"
        >
          Powered by GoUplift
        </Link>
      </footer>
    </div>
  );
}
