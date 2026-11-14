import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Action = { href: string; label: string };

/**
 * What a visitor sees at a link that leads nowhere. Plain words, and two ways
 * forward: the page sits under the site header, so the menu is there too.
 * The copy is passed as strings, not written into the JSX, so an apostrophe
 * can't trip the JSX text handling.
 */
export function NotFoundContent({
  title = "We can't find that page",
  description = "The link may be mistyped, or the page may have moved or been removed.",
  primary = { href: "/", label: "Go to the homepage" },
  secondary = { href: "/fundraisers", label: "Browse fundraisers" },
}: {
  title?: string;
  description?: string;
  primary?: Action;
  secondary?: Action;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-24 pt-36 text-center">
      <p className="text-sm font-medium text-muted-foreground">Error 404</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 text-pretty text-lg text-muted-foreground">
        {description}
      </p>
      <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
        <Link href={primary.href} className={cn(buttonVariants({ size: "lg" }))}>
          {primary.label}
        </Link>
        <Link
          href={secondary.href}
          className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
        >
          {secondary.label}
        </Link>
      </div>
    </div>
  );
}
