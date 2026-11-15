import type { Metadata } from "next";
import { absoluteUrl } from "./seo";
import { SHARE_IMAGE, SITE_NAME } from "./site";

// What shows when a link to a fundraiser or an organization is pasted into
// WhatsApp, Facebook, X or a message: its own title, a short description, its
// own picture, and one address (the canonical one) that every copy of the link
// points back to. Kept here, apart from the pages, so the rules can be tested
// without a running site or a database.

/**
 * Where a picture may come from to be used as a share image: the same hosts
 * next.config.ts lets the image optimizer fetch from (a test keeps the two in
 * step). A `*` stands for one part of a host name, as it does there.
 */
export const OPTIMIZABLE_IMAGE_HOSTS = [
  "*.convex.cloud",
  "*.unsplash.com",
] as const;

// The width the optimizer is asked for: it is one of the sizes Next.js allows
// by default, and the usual width of a share picture.
const IMAGE_WIDTH = 1200;
// Next.js only serves the qualities listed in images.qualities, 75 by default.
const IMAGE_QUALITY = 75;

export const SHARE_DESCRIPTION_LENGTH = 160;

const HOST_PATTERNS = OPTIMIZABLE_IMAGE_HOSTS.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^.]+")}$`,
    ),
);

/** Whether the picture is one our own image optimizer is allowed to fetch. */
export function canOptimizeImage(src: string): boolean {
  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * The first of these with something in it, as one tidy line that fits a link
 * preview: whitespace squeezed, and cut at a word with "…" if it is too long.
 * `fallback` is used when they are all empty.
 */
export function shareDescription(
  candidates: ReadonlyArray<string | null | undefined>,
  fallback: string,
  max: number = SHARE_DESCRIPTION_LENGTH,
): string {
  for (const candidate of candidates) {
    const flat = candidate?.replace(/\s+/g, " ").trim();
    if (!flat) continue;

    // Count characters, not UTF-16 units, so an emoji is never cut in half.
    const chars = Array.from(flat);
    if (chars.length <= max) return flat;

    const cut = chars.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    // Back up to the end of a word, unless that would throw most of it away.
    const kept = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${kept.join("").trimEnd()}…`;
  }
  return fallback;
}

type ShareImage = {
  url: string;
  alt: string;
  width?: number;
  height?: number;
};

/**
 * The picture for a link preview: the first of the page's own pictures that
 * can be used, or the GoUplift logo card when there is none. Its own picture
 * goes through our image optimizer first: people upload photos of several
 * megabytes, and WhatsApp shows no picture at all when it is much over a few
 * hundred kilobytes. A picture from somewhere the optimizer can't reach is
 * skipped rather than sent as it is.
 */
export function shareImage(
  candidates: ReadonlyArray<string | null | undefined>,
  alt: string,
): ShareImage {
  const src = candidates.find(
    (candidate): candidate is string =>
      !!candidate && canOptimizeImage(candidate),
  );
  if (!src) return { ...SHARE_IMAGE };
  return {
    url: `/_next/image?url=${encodeURIComponent(src)}&w=${IMAGE_WIDTH}&q=${IMAGE_QUALITY}`,
    alt,
  };
}

/**
 * The title, description, canonical address and share picture of a page.
 * A page that sets its own openGraph or twitter replaces the site-wide ones
 * whole, so the site name and language are given again here.
 */
export function shareMetadata(input: {
  /** The page's address, from the root: "/fundraiser/abc". No query string. */
  path: string;
  /** What the browser tab says. */
  title: string;
  /** What a link preview says, when it should differ from the tab. */
  shareTitle?: string;
  description: string;
  /** The page's own pictures, best first. None: the GoUplift logo card. */
  images: ReadonlyArray<string | null | undefined>;
  /** What the picture shows, for people who can't see it. */
  imageAlt: string;
}): Metadata {
  const url = absoluteUrl(input.path);
  const title = input.shareTitle ?? input.title;
  const image = shareImage(input.images, input.imageAlt);

  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_KE",
      url,
      title,
      description: input.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: input.description,
      images: [image],
    },
  };
}
