export const SITE_NAME = "GoUplift";

export const SITE_URL = "https://www.gouplift.africa";

export const SITE_TITLE = "GoUplift | Crowdfunding for Kenya";

// The picture shown when a link is shared. It is built in app/opengraph-image.tsx.
// A page that sets its own openGraph or twitter metadata replaces the shared
// defaults, picture included, so such pages list it again with this.
export const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "GoUplift: crowdfunding for Kenya",
};

export const SITE_DESCRIPTION =
  "GoUplift is a Kenyan crowdfunding platform. Start a fundraiser, tell your story and accept donations in Kenyan shillings through SasaPay or in US dollars through PayPal.";

/**
 * Where people can reach GoUplift. Left empty on purpose until real details
 * exist: the footer shows "Contact Support" and the Community links only when
 * these are filled in, so nothing points at an address or account that isn't
 * ours.
 */
export const SUPPORT_EMAIL: string | null = null;

export const SOCIAL_LINKS: Array<{ href: string; label: string }> = [];
