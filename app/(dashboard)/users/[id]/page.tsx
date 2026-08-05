"use client";

import { Card } from "@/components/ui/card";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

interface FollowButtonProps {
  isLoggedIn: boolean;
  isOwner: boolean;
  isFollowing: boolean;
  onFollowToggle?: () => void;
  className?: string;
}

function FollowButton({
  isLoggedIn,
  isOwner,
  isFollowing,
  onFollowToggle,
  className = "mt-6 w-full",
}: FollowButtonProps) {
  // 1. Unauthenticated State (Disabled + Tooltip)
  if (!isLoggedIn) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div className="w-full" />}>
            <Button className={className} disabled>
              Follow
            </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>
            Sign in to follow organizers.{" "}
            <Link href="/sign-in" className="font-semibold underline">
              Sign in
            </Link>
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // 2. Owner State (Edit Profile)
  if (isOwner) {
    return (
      <Link href="/profile" className="w-full">
        <Button variant="outline" className={className}>
          Edit Profile
        </Button>
      </Link>
    );
  }

  // 3. Following State (Active Follower)
  if (isFollowing) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div className="w-full" />}>
          <Button
            variant="outline"
            className={className}
            onClick={onFollowToggle}
          >
            Following
          </Button>
        </TooltipTrigger>

        <TooltipContent>Unfollow</TooltipContent>
      </Tooltip>
    );
  }

  // 4. Default Authenticated State (Follow)
  return (
    <Button variant="default" onClick={onFollowToggle} className={className}>
      Follow
    </Button>
  );
}

export default function Users() {
  const { id } = useParams<{ id: string }>();

  const { data: session } = authClient.useSession();

  const user = useQuery(api.users.getUserById, {
    authUserId: id,
  });

  const isLoggedIn = !!session?.user;

  const isOwner = !!user && session?.user?.id === user.authUserId;

  const isFollowing = useQuery(
    api.users.isFollowing,
    user && isLoggedIn && !isOwner
      ? {
          followerId: session.user!.id,
          followingId: user.authUserId,
        }
      : "skip",
  );

  const toggleFollow = useMutation(api.users.toggleFollow);

  if (user === undefined) {
    return <div>Loading...</div>;
  }

  if (user === null) {
    return <div>User not found.</div>;
  }

  async function handleFollow() {
    if (!session?.user || !user) return;

    await toggleFollow({
      followerId: session.user.id,
      followingId: user.authUserId,
    });
  }

  return (
    <section>
      <div className="bg-muted/50 py-24">
        <div className="mx-auto w-full max-w-5xl px-6">
          <div>
            <h2 className="mt-4 text-4xl font-semibold">Organizers</h2>

            <p className="mb-12 mt-4 text-lg text-muted-foreground">
              Search for and follow your favourite organizers
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="bg-accent p-6">
              <div className="flex aspect-video items-center justify-center">
                <Avatar className="h-40 w-40 shadow-lg ring-4 ring-background">
                  <AvatarImage src={user.image ?? ""} alt={user.displayName} />

                  <AvatarFallback>
                    {getInitials(user.displayName)}
                  </AvatarFallback>
                </Avatar>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex aspect-video flex-col items-center justify-center gap-2">
                <h3 className="text-2xl font-semibold">{user.displayName}</h3>

                {user.username && (
                  <p className="text-muted-foreground">@{user.username}</p>
                )}
              </div>

              <FollowButton
                isLoggedIn={isLoggedIn}
                isOwner={isOwner}
                isFollowing={!!isFollowing}
                onFollowToggle={handleFollow}
                className="mt-0 w-full"
              />
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
