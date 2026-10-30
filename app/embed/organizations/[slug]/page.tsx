import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { EmbedFrame } from "@/components/web/embed/embed-frame";
import {
  EmbedMessage,
  EmbedWidget,
} from "@/components/web/embed/embed-widget";

// The page that public/embed.js puts inside an iframe on an organization's
// own website:  /embed/organizations/<slug>?limit=6&theme=light
//
// It is outside the (dashboard) group on purpose: no navbar, no footer. And
// next.config.ts is what allows it to be framed by other sites — every other
// route refuses.

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    limit?: string | string[];
    theme?: string | string[];
  }>;
};

export const metadata: Metadata = {
  title: "Fundraisers on GoUplift",
  // A widget, not a page anyone should find in a search.
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// A bad value shouldn't blank someone's website: fall back to the default.
function parseLimit(raw: string | undefined) {
  if (!raw || !/^\d{1,3}$/.test(raw)) return DEFAULT_LIMIT;
  const limit = Number(raw);
  return limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT;
}

async function loadWidgetData(slug: string, limit: number) {
  try {
    const organization = await fetchQuery(
      api.organizations.getPublicOrganization,
      { slug },
    );
    // Same rule as the public API: only verified organizations.
    if (!organization?.isVerified) return null;

    const fundraisers = await fetchQuery(
      api.organizations.listOrganizationFundraisers,
      { organizationId: organization._id },
    );
    return { organization, fundraisers: fundraisers.slice(0, limit) };
  } catch (error) {
    console.error("Embed failed to load", error);
    return null;
  }
}

export default async function EmbedOrganizationPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params;
  const query = await searchParams;
  const limit = parseLimit(first(query.limit));
  const dark = first(query.theme) === "dark";

  const data = await loadWidgetData(slug, limit);

  return (
    <EmbedFrame dark={dark}>
      {data ? (
        <EmbedWidget
          organization={data.organization}
          fundraisers={data.fundraisers}
        />
      ) : (
        <EmbedMessage>
          This fundraising widget isn&apos;t available right now.
        </EmbedMessage>
      )}
    </EmbedFrame>
  );
}
