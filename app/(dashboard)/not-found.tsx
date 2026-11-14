import type { Metadata } from "next";
import { NotFoundContent } from "@/components/web/error/not-found-content";

export const metadata: Metadata = {
  title: "Page not found | GoUplift",
};

// For notFound() inside the public pages. The layout above already provides
// the header and footer.
export default function NotFound() {
  return <NotFoundContent />;
}
