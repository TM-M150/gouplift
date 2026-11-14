import type { Metadata } from "next";
import { NotFoundContent } from "@/components/web/error/not-found-content";

export const metadata: Metadata = {
  title: "Fundraiser not found | GoUplift",
};

// The likeliest broken link on the site: a fundraiser someone shared. It is
// also what a private or unpublished fundraiser looks like to anyone but its
// owner, so the wording doesn't say which of these it is.
export default function FundraiserNotFound() {
  return (
    <NotFoundContent
      title="We can't find that fundraiser"
      description="The link may be wrong, or the fundraiser may be private or no longer available. If someone sent you this link, ask them to check it."
      primary={{ href: "/fundraisers", label: "Browse fundraisers" }}
      secondary={{ href: "/", label: "Go to the homepage" }}
    />
  );
}
