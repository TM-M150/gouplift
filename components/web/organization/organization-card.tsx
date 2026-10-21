import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/utils";

export interface OrganizationCardData {
  _id: string;
  slug: string;
  name: string;
  description: string | null;
  isVerified: boolean;
  logoUrl: string | null;
}

export function OrganizationCard({
  organization,
}: {
  organization: OrganizationCardData;
}) {
  return (
    <Link href={`/organizations/${organization.slug}`} className="block h-full">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {/* Plain Avatar (not next/image): logoUrl can be any host,
                which next.config's remotePatterns wouldn't allow. */}
            <Avatar className="size-14">
              {organization.logoUrl && (
                <AvatarImage
                  src={organization.logoUrl}
                  alt={organization.name}
                />
              )}
              <AvatarFallback className="font-semibold">
                {getInitials(organization.name)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 space-y-1">
              <h3 className="line-clamp-1 text-lg font-semibold">
                {organization.name}
              </h3>
              {organization.isVerified && (
                <Badge variant="secondary">
                  <BadgeCheck />
                  Verified
                </Badge>
              )}
            </div>
          </div>

          <p className="line-clamp-3 text-sm text-muted-foreground">
            {organization.description ?? "No description yet."}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function OrganizationCardSkeleton() {
  return (
    <Card className="h-full">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-6 w-1/2" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </CardContent>
    </Card>
  );
}
