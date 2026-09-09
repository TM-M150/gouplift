"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { LogoCloud } from "./logo-cloud";

export function Info() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="text-muted-foreground max-w-3xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            <span className="text-foreground">Revenue, aligned.</span> <br />
            One timeline per customer.
          </h2>

          <div className="flex items-center gap-3 shrink-0">
            <Button variant="default" size="lg" className="rounded-full px-6">
              Follow
            </Button>
            <Link
              href="/message"
              className={buttonVariants({
                variant: "secondary",
                size: "lg",
                className: "rounded-full px-6",
              })}
            >
              Message
            </Link>
          </div>
        </div>

        {/* Content Card Section */}
        <div className="bg-card text-card-foreground mt-8 rounded-xl border p-6 md:p-8 shadow-sm">
          <h3 className="text-xl font-semibold mb-3">
            The Joke Tax Chronicles
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Once upon a time, in a far-off land, there was a very lazy king who
            spent all day lounging on his throne. One day, his advisors came to
            him with a problem: the kingdom was running out of money.
          </p>

          {!isExpanded && (
            <Button
              onClick={() => setIsExpanded(true)}
              variant="link"
              className="text-primary p-0 h-auto font-medium"
            >
              Read More
            </Button>
          )}

          {isExpanded && (
            <Collapsible open onOpenChange={setIsExpanded}>
              <CollapsibleContent className="space-y-4">
                <div className="prose prose-gray dark:prose-invert text-muted-foreground leading-relaxed space-y-4">
                  <p>
                    The king thought long and hard, and finally came up with a
                    brilliant plan: he would tax the jokes in the kingdom.
                  </p>
                  <p>
                    Jokester began sneaking into the castle in the middle of the
                    night and leaving jokes all over the place: under the king's
                    pillow, in his soup, even in the royal toilet. The king was
                    furious, but he couldn't seem to stop Jokester.
                  </p>
                  <p>
                    And then, one day, the people of the kingdom discovered that
                    the jokes left by Jokester were so funny that they couldn't
                    help but laugh. And once they started laughing, they
                    couldn't stop.
                  </p>
                </div>
              </CollapsibleContent>

              <CollapsibleTrigger
                render={
                  <Button
                    variant="link"
                    className="text-primary p-0 h-auto font-medium mt-4"
                  />
                }
              >
                Read Less
              </CollapsibleTrigger>
            </Collapsible>
          )}
        </div>
      </div>
      <LogoCloud />
    </section>
  );
}
