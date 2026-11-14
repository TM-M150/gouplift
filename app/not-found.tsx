import type { Metadata } from "next";
import { NotFoundContent } from "@/components/web/error/not-found-content";
import { SiteShell } from "@/components/web/site-shell";

export const metadata: Metadata = {
  title: "Page not found | GoUplift",
};

// A link that matches no page at all. This sits outside the public layout, so
// it brings the site header and footer itself. Pages that call notFound() from
// inside that layout use app/(dashboard)/not-found.tsx instead.
export default function NotFound() {
  return (
    <SiteShell>
      <NotFoundContent />
    </SiteShell>
  );
}
