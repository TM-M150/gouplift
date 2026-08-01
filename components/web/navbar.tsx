"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "../icons/logo";
import React, { useEffect } from "react";
import {
  Heart,
  Info,
  Lightbulb,
  LogOut,
  LucideIcon,
  Menu,
  X,
  ChevronDown,
  User,
  Megaphone,
  TrendingUp,
  MessageSquare,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button, buttonVariants } from "../ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "../ui/navigation-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { cn } from "@/lib/utils";

interface navigationItems {
  title: string;
  description: string;
  href: string;
}

const fundraise: navigationItems[] = [
  {
    title: "How to start a fundraiser",
    description: "Step-by-step help, examples and more",
    href: "#",
  },
  {
    title: "Fundraising tips",
    description: "The ultimate fundraising tips guide",
    href: "#",
  },
  {
    title: "Fundraising categories",
    description: "Find the right category for you",
    href: "#",
  },
  {
    title: "Fundraising ideas",
    description: "Ideas to spark your creativity",
    href: "#",
  },
];

const donate: navigationItems[] = [
  {
    title: "Discover fundraisers to support",
    description: "Find causes that matter to you",
    href: "#",
  },
];

const about: navigationItems[] = [
  {
    title: "Our Story",
    description: "Learn about our mission, vision, and how we got started",
    href: "#",
  },
  {
    title: "Leadership & Team",
    description: "Meet the people behind our organization driving impact",
    href: "#",
  },
  {
    title: "Impact & Transparency",
    description: "See how contributions make a difference and our reports",
    href: "#",
  },
  {
    title: "Careers & Culture",
    description: "Join our team and help us build a better community",
    href: "#",
  },
];

interface navigationProps {
  triggerLabel: string;
  headerTitle: string;
  headerIcon: LucideIcon | React.ComponentType<{ className?: string }>;
  items: navigationItems[];
  columns?: 1 | 2;
  align?: "start" | "center" | "end";
}

function NavigationSection({
  triggerLabel,
  headerTitle,
  headerIcon: IconComponent,
  items,
  columns = 2,
}: navigationProps) {
  const widthClass = columns === 2 ? "w-[540px]" : "w-80";
  const gridClass =
    columns === 2 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2";

  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger>{triggerLabel}</NavigationMenuTrigger>
      <NavigationMenuContent>
        <div className={`${widthClass} p-4`}>
          <div className="flex items-center gap-3 p-3 mb-2 rounded-xl">
            <div className="p-2 rounded-full bg-slate-100 flex items-center justify-center">
              <IconComponent className="w-5 h-5 text-foreground" />
            </div>
            <span className="font-semibold">{headerTitle}</span>
          </div>
          <div className={gridClass}>
            {items.map((item, index) => (
              <Link
                key={index}
                href={item.href}
                className="block p-3 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <div className="font-semibold text-slate-900">{item.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {item.description}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
}

interface mobileNavigationProps {
  value: string;
  triggerLabel: string;
  items: navigationItems[];
  onNavigate: () => void;
}

function MobileNavigationSection({
  value,
  triggerLabel,
  items,
  onNavigate,
}: mobileNavigationProps) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-base font-semibold hover:no-underline">
        {triggerLabel}
      </AccordionTrigger>
      <AccordionContent className="no-underline">
        <div className="flex flex-col gap-1 pb-2">
          {items.map((item, index) => (
            <Link
              key={index}
              href={item.href}
              onClick={onNavigate}
              className="block rounded-xl p-3"
            >
              <div className="font-semibold">{item.title}</div>
              <div className="text-xs mt-0.5">{item.description}</div>
            </Link>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface ActionButtonsProps {
  onNavigate?: () => void;
  className?: string;
}

function ActionButtons({ onNavigate, className = "" }: ActionButtonsProps) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

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

  // Helper to extract initials for Avatar fallback
  const getInitials = (name?: string) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const firstName = session?.user.name?.split(" ")[0] || "Account";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* 1. Loading State */}
      {isPending ? (
        <Skeleton className="h-9 w-24 rounded-md" />
      ) : session ? (
        /* 2. Logged In State: Avatar + first name + chevron opens the account menu */
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2">
            <Avatar className="h-8 w-8 border">
              <AvatarImage src={session.user.image || ""} alt={session.user.name || "User"} />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {getInitials(session.user.name)}
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
              className="cursor-pointer"
            >
              <User className="mr-2 size-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleNavigate("#")}
              className="cursor-pointer"
            >
              <Megaphone className="mr-2 size-4" />
              <span>Your fundraisers</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleNavigate("/your-impact")}
              className="cursor-pointer"
            >
              <TrendingUp className="mr-2 size-4" />
              <span>Your impact</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleNavigate("#")}
              className="cursor-pointer"
            >
              <Settings className="mr-2 size-4" />
              <span>Account settings</span>
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
        /* 3. Logged Out State: Show "Sign in" & "Start a Fundraiser" */
        <>
          <Link
            href="/sign-in"
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "w-full sm:w-auto font-medium"
            )}
          >
            Sign in
          </Link>

          <Link
            href="/sign-up"
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: "default" }),
              "w-full sm:w-auto font-medium"
            )}
          >
            Start a Fundraiser
          </Link>
        </>
      )}
    </div>
  );
}

export function Navbar() {
  const [menuState, setMenuState] = React.useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const handleResize = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setMenuState(false);
      }
    };

    mediaQuery.addEventListener("change", handleResize);

    return () => {
      mediaQuery.removeEventListener("change", handleResize);
    };
  }, []);

  return (
    <header>
      <nav className="bg-background fixed top-0 z-20 w-full border-b">
        <div className="mx-auto max-w-7xl px-6">
          <div className="relative flex flex-wrap items-center justify-between py-4">
            <div className="flex w-full justify-between lg:w-auto">
              <Link
                href="/"
                aria-label="home"
                className="flex items-center space-x-2"
              >
                <Logo size={40} className="w-10 h-10 my-auto" />
              </Link>

              {/* Mobile Navigation Menu (Sheet + Accordion) */}
              <Sheet open={menuState} onOpenChange={setMenuState}>
                <SheetTrigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label={menuState ? "Close Menu" : "Open Menu"}
                      className="relative z-20 block cursor-pointer lg:hidden"
                    >
                      {menuState ? (
                        <X className="m-auto size-6" />
                      ) : (
                        <Menu className="m-auto size-6" />
                      )}
                    </Button>
                  }
                />
                <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
                  <SheetHeader className="border-b px-6 py-4">
                    <SheetTitle className="sr-only">Site navigation</SheetTitle>
                    <SheetDescription className="sr-only">
                      Browse donate, fundraise, and about links
                    </SheetDescription>
                    <Link
                      href="/"
                      onClick={() => setMenuState(false)}
                      className="flex items-center"
                    >
                      <Logo size={32} className="w-8 h-8" />
                    </Link>
                  </SheetHeader>
                  <div className="overflow-y-auto px-6 py-2">
                    <Accordion className="w-full">
                      <MobileNavigationSection
                        value="donate"
                        triggerLabel="Donate"
                        items={donate}
                        onNavigate={() => setMenuState(false)}
                      />
                      <MobileNavigationSection
                        value="fundraise"
                        triggerLabel="Fundraise"
                        items={fundraise}
                        onNavigate={() => setMenuState(false)}
                      />
                      <MobileNavigationSection
                        value="about"
                        triggerLabel="About Us"
                        items={about}
                        onNavigate={() => setMenuState(false)}
                      />
                    </Accordion>
                  </div>
                  <SheetFooter>
                    <div className="border-t p-6 mt-auto">
                      <ActionButtons
                        onNavigate={() => setMenuState(false)}
                        className="flex-col w-full"
                      />
                    </div>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop Navigation Menu */}
            <div className="absolute inset-0 m-auto size-fit max-lg:hidden">
              <NavigationMenu align="center">
                <NavigationMenuList>
                  <NavigationSection
                    triggerLabel="Donate"
                    headerTitle="Discover causes to support"
                    headerIcon={Heart}
                    items={donate}
                    columns={1}
                  />

                  <NavigationSection
                    triggerLabel="Fundraise"
                    headerTitle="Start fundraising now, Tips and Ideas"
                    headerIcon={Lightbulb}
                    items={fundraise}
                    columns={2}
                  />

                  <NavigationSection
                    triggerLabel="About Us"
                    headerTitle="How gouplift works, pricing and more"
                    headerIcon={Info}
                    items={about}
                    columns={2}
                  />
                </NavigationMenuList>
              </NavigationMenu>
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <ActionButtons />
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
