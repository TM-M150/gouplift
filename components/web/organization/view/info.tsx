"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { LogoCloud } from "./logo-cloud";

interface InfoProps {
  organization: {
    name: string;
    description?: string;
  };
}

export function Info({ organization }: InfoProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const name = organization.name;
  const description =
    organization.description ||
    "Empowering communities and creating lasting impact through transparent fundraising.";

  const previewLimit = 200;
  const isLongDescription = description.length > previewLimit;
  const previewText = isLongDescription
    ? `${description.slice(0, previewLimit)}...`
    : description;

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-6">
        {/* Header Block */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="text-muted-foreground max-w-3xl text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            <span className="text-foreground">{name}</span> <br />
            <span className="text-2xl font-normal lg:text-3xl">
              Driving meaningful change together.
            </span>
          </h2>

          <div className="flex shrink-0 items-center gap-3">
            <Button variant="default" size="lg" className="rounded-full px-6">
              Follow
            </Button>
            <Link
              href={`/message`}
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

        {/* About Card Section */}
        <div className="bg-card text-card-foreground mt-8 rounded-xl border p-6 shadow-sm md:p-8">
          <h3 className="mb-3 text-xl font-semibold">About Us</h3>

          {!isExpanded ? (
            <div>
              <p className="text-muted-foreground leading-relaxed">
                {previewText}
              </p>
              {isLongDescription && (
                <Button
                  onClick={() => setIsExpanded(true)}
                  variant="link"
                  className="text-primary mt-2 h-auto p-0 font-medium"
                >
                  Read More
                </Button>
              )}
            </div>
          ) : (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleContent>
                <div className="prose prose-gray dark:prose-invert text-muted-foreground leading-relaxed whitespace-pre-line">
                  <p>{description}</p>
                </div>
              </CollapsibleContent>

              <CollapsibleTrigger
                render={
                  <Button
                    variant="link"
                    className="text-primary mt-4 h-auto p-0 font-medium"
                  >
                    Read Less
                  </Button>
                }
              />
            </Collapsible>
          )}
        </div>
      </div>
      <LogoCloud />
    </section>
  );
}
