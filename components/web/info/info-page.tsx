import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { StartFundraiserLink } from "@/components/web/home/start-fundraiser-link";
import { cn } from "@/lib/utils";

/**
 * The frame shared by the plain information pages (pricing, trust, help...).
 * The layout around it already provides <main>.
 */
export function InfoPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-20 pt-28">
      <header className="space-y-4 border-b pb-10">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">{lead}</p>
      </header>
      <div className="space-y-12 pt-10">{children}</div>
    </div>
  );
}

export function InfoSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-4 leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export function InfoCta() {
  return (
    <div className="flex flex-col gap-2 border-t pt-10 sm:flex-row">
      <StartFundraiserLink />
      <Link
        href="/fundraisers"
        className={cn(buttonVariants({ variant: "ghost" }))}
      >
        Browse fundraisers
      </Link>
    </div>
  );
}
