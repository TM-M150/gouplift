"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { Heart, Info, Lightbulb, Menu, X } from "lucide-react";

import Logo from "../../icons/logo";
import { Button } from "../../ui/button";
import { NavigationMenu, NavigationMenuList } from "../../ui/navigation-menu";
import { Accordion } from "../../ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../ui/sheet";

import { NavigationSection } from "./navigation-section";
import { MobileNavigationSection } from "./mobile-navigation-section";
import { ActionButtons } from "./action-buttons";
import { fundraise, donate, about } from "./navigation-data";

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
                aria-label="GoUpLift home"
                className="flex items-center gap-2"
              >
                <Logo size={40} className="h-10 w-10 shrink-0" />

                <span className="hidden text-4xl font-extrabold tracking-tight sm:inline">
                  <span className="text-primary">GOUP</span>
                  <span className="text-secondary">LIFT</span>
                </span>
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
