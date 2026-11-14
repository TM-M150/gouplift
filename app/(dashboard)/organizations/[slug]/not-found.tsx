import type { Metadata } from "next";
import { NotFoundContent } from "@/components/web/error/not-found-content";

export const metadata: Metadata = {
  title: "Organization not found | GoUplift",
};

export default function OrganizationNotFound() {
  return (
    <NotFoundContent
      title="We can't find that organization"
      description="The link may be wrong, or the organization may no longer be listed."
      primary={{ href: "/organizations", label: "Browse organizations" }}
      secondary={{ href: "/", label: "Go to the homepage" }}
    />
  );
}
