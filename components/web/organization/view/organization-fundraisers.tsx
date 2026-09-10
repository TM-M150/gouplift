"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Heart, Users } from "lucide-react";

interface OrganizationFundraisersProps {
  organizationId: Id<"organizations">;
}

export function OrganizationFundraisers({
  organizationId,
}: OrganizationFundraisersProps) {
  const fundraisers = useQuery(
    api.organizations.getPublicFundraisersByOrganization,
    { organizationId },
  );

  if (!fundraisers || fundraisers.length === 0) {
    return null;
  }

  return (
    <section className="pt-6 pb-16 md:pt-8 md:pb-20">
      <div className="mx-auto max-w-7xl px-6 space-y-24">
        <div className="space-y-4">
          <h2 className="text-muted-foreground max-w-4xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            <span className="text-foreground">Active Fundraisers</span>
            <br />
            Support causes championed by this organization.
          </h2>
        </div>

        {fundraisers.map((fundraiser) => {
          const actualPercent =
            fundraiser.goalAmount > 0
              ? Math.round(
                  (fundraiser.amountRaised / fundraiser.goalAmount) * 100,
                )
              : 0;

          const progressValue = Math.min(actualPercent, 100);

          const defaultCover =
            "https://images.unsplash.com/photo-1648878136531-15e7d3a88e76?q=80&w=694&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

          return (
            <div
              key={fundraiser._id}
              className="grid items-stretch gap-6 sm:grid-cols-2 md:gap-12 lg:gap-24"
            >
              {/* Media Container */}
              <div className="relative mb-6 flex h-full min-h-[340px] flex-col sm:mb-0">
                <div className="relative h-full w-full overflow-hidden rounded-2xl bg-gradient-to-b from-zinc-300 to-transparent p-px dark:from-zinc-700">
                  <Image
                    src={fundraiser.coverImage || defaultCover}
                    className="object-cover rounded-2xl"
                    alt={fundraiser.title}
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                </div>
              </div>

              {/* Fundraiser Details */}
              <div className="relative flex flex-col justify-between space-y-6">
                <div className="space-y-3">
                  <span className="text-xs font-semibold tracking-wider text-primary uppercase">
                    {fundraiser.type.replace("_", " ")}
                  </span>
                  <h3 className="relative z-10 max-w-xl text-3xl font-medium lg:text-4xl">
                    {fundraiser.title}
                  </h3>
                  {fundraiser.tagline && (
                    <p className="text-muted-foreground text-lg leading-relaxed">
                      {fundraiser.tagline}
                    </p>
                  )}
                </div>

                {/* Story Snippet */}
                <div className="border-l-4 border-primary/40 pl-4 py-1">
                  <p className="text-muted-foreground line-clamp-3 leading-relaxed">
                    {fundraiser.story}
                  </p>
                </div>

                {/* Financial Progress & Metrics */}
                <div className="space-y-3">
                  <div className="flex justify-between text-sm font-medium">
                    <span>
                      {fundraiser.currency}{" "}
                      {fundraiser.amountRaised.toLocaleString()} raised
                    </span>
                    <span className="text-primary font-semibold">
                      {actualPercent}% of {fundraiser.currency}{" "}
                      {fundraiser.goalAmount.toLocaleString()}
                    </span>
                  </div>

                  {/* Visual Progress Bar receives capped value */}
                  <Progress value={progressValue} className="h-2" />

                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <Users className="size-4" />
                    <span>{fundraiser.donorCount} Donors</span>
                  </div>
                </div>

                {/* Call to Actions */}
                <div className="flex items-center gap-4 pt-4">
                  <Link
                    href={`/fundraiser/${fundraiser._id}`}
                    className={buttonVariants({
                      variant: "default",
                      size: "lg",
                      className: "rounded-full px-6 gap-2",
                    })}
                  >
                    <Heart className="size-4 fill-current" />
                    Donate Now
                  </Link>
                  <Link
                    href={`/fundraiser/${fundraiser._id}`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "lg",
                      className: "rounded-full px-6",
                    })}
                  >
                    Read Campaign
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
