"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { Menu } from "lucide-react";

import { api } from "@/convex/_generated/api";
import Logo from "@/components/icons/logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn, getInitials } from "@/lib/utils";
import { adminNav } from "./admin-nav";

function Brand() {
  return (
    <Link href="/admin" className="flex h-14 items-center gap-2 border-b px-4">
      <Logo size={32} className="size-8 shrink-0" />
      <span className="font-extrabold tracking-tight">
        <span className="text-primary">GOUP</span>
        <span className="text-secondary">LIFT</span>
      </span>
      <Badge variant="secondary">Admin</Badge>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {adminNav.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);

        if (!item.ready) {
          return (
            <div
              key={item.href}
              className="flex h-9 items-center gap-2 rounded-2xl px-3 text-sm text-muted-foreground/60"
            >
              <Icon className="size-4" />
              <span>{item.title}</span>
              <Badge variant="outline" className="ml-auto">
                Soon
              </Badge>
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-9 w-full justify-start gap-2",
              active && "bg-muted font-semibold",
            )}
          >
            <Icon />
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const me = useQuery(api.users.getCurrentUser);

  return (
    <div className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-background lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu />
                </Button>
              }
            />
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">Admin navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Browse admin sections
                </SheetDescription>
                <Brand />
              </SheetHeader>
              <SidebarNav onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          {me && (
            <div className="ml-auto flex items-center gap-3">
              <Badge variant="outline">{me.role}</Badge>
              <Avatar className="size-8 border">
                {me.image && <AvatarImage src={me.image} alt={me.name} />}
                <AvatarFallback className="text-xs font-semibold">
                  {getInitials(me.name)}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
        </header>

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
