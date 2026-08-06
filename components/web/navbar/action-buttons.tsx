"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "convex/react";

import { authClient } from "@/lib/auth-client";
import { buttonVariants } from "../../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, getInitials } from "@/lib/utils";
import { api } from "@/convex/_generated/api";

interface ActionButtonsProps {
  onNavigate?: () => void;
  className?: string;
}

export function ActionButtons({ onNavigate, className = "" }: ActionButtonsProps) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { user: currentUser } = session ?? {};

  const profile = useQuery(api.users.getCurrentUserProfile);
  const { name = "" } = currentUser ?? {};
  const avatarUrl = profile?.image || currentUser?.image || "";

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          toast.success("Logged out successfully");
          if (onNavigate) onNavigate();
          router.push("/");
        },
        onError: (ctx) => {
          toast.error(ctx.error.message || "Failed to log out");
        },
      },
    });
  };

  const handleNavigate = (href: string) => {
    if (onNavigate) onNavigate();
    router.push(href);
  };

  const firstName = name?.split(" ")[0] || "Account";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {isPending ? (
        <Skeleton className="h-9 w-24 rounded-md" />
      ) : session ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2">
            <Avatar className="h-8 w-8 border">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium max-w-[100px] truncate">
              {firstName}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onClick={() => handleNavigate("/profile")}
              className="cursor-pointer h-4"
            >
              <User className="mr-2 size-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 size-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Link
            href="/sign-in"
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "w-full sm:w-auto font-medium",
            )}
          >
            Sign in
          </Link>

          <Link
            href="/sign-up"
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: "default" }),
              "w-full sm:w-auto font-medium",
            )}
          >
            Start a Fundraiser
          </Link>
        </>
      )}
    </div>
  );
}
