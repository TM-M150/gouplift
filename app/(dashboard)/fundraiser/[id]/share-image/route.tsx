import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchQuery } from "convex/nextjs";
import { ImageResponse } from "next/og";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ShareCard,
  SHARE_CARD_PHOTO,
} from "@/components/web/fundraiser/share-card";
import { canOptimizeImage } from "@/lib/share";
import {
  SHARE_CARD_SIZE,
  shareCardFigures,
  shareCardKind,
  shareCardTitle,
} from "@/lib/share-card";

// The picture shown when a link to this fundraiser is shared. See
// lib/share-card.ts for what it says and components/web/fundraiser/share-card.tsx
// for how it looks.
//
// It is served as a JPEG, not the PNG the drawing produces: WhatsApp shows no
// picture at all when it is much over a few hundred kilobytes, and a PNG of a
// photograph is several times that.

const FONTS = [
  ["inter-latin-400-normal.woff", 400],
  ["inter-latin-600-normal.woff", 600],
  ["inter-latin-700-normal.woff", 700],
] as const;

const FOREST = "#072b19";

// A photo bigger than this is left out rather than loaded into memory.
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 5000;

let fonts: ReturnType<typeof readFonts> | undefined;

function readFonts() {
  return Promise.all(
    FONTS.map(async ([file, weight]) => ({
      name: "Inter",
      weight,
      style: "normal" as const,
      data: await readFile(join(process.cwd(), "assets/fonts", file)),
    })),
  ).catch(() => []); // without them the card is set in the default font
}

async function loadFundraiser(id: string) {
  try {
    return await fetchQuery(api.fundraiser.getFundraiserById, {
      fundraiserId: id as Id<"fundraisers">,
    });
  } catch {
    return null;
  }
}

/**
 * The fundraiser's photo, cut to the card's photo area and as a data address
 * for the drawing, or null when there is none or it can't be used: a picture
 * from a host we don't serve images from, too big, slow, or not an image.
 */
async function loadPhoto(
  src: string | null | undefined,
  sharp: typeof import("sharp"),
): Promise<string | null> {
  if (!src || !canOptimizeImage(src)) return null;
  try {
    const response = await fetch(src, {
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_PHOTO_BYTES) return null;
    const original = Buffer.from(await response.arrayBuffer());
    if (original.byteLength > MAX_PHOTO_BYTES) return null;

    const cut = await sharp(original)
      .rotate()
      .resize(SHARE_CARD_PHOTO.width, SHARE_CARD_PHOTO.height, {
        fit: "cover",
        position: "attention",
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${cut.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fundraiser = await loadFundraiser(id);
  // Not there, or not one that anyone may see: the same as the page.
  if (!fundraiser) return new Response("Not found", { status: 404 });

  let sharp: typeof import("sharp") | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // Without it there is no photo and the card is sent as it is drawn.
  }

  const photo = sharp ? await loadPhoto(fundraiser.coverImageUrl, sharp) : null;

  fonts ??= readFonts();
  const drawn = new ImageResponse(
    <ShareCard
      title={shareCardTitle(fundraiser.title)}
      kind={shareCardKind(fundraiser)}
      figures={shareCardFigures(fundraiser)}
      photo={photo}
    />,
    { ...SHARE_CARD_SIZE, fonts: await fonts },
  );
  const png = Buffer.from(await drawn.arrayBuffer());

  // The address has the figures in it, so a new total is a new address and a
  // long cache is safe.
  const cache =
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

  if (sharp) {
    try {
      const jpeg = await sharp(png)
        .flatten({ background: FOREST })
        .jpeg({ quality: 86, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      return new Response(new Uint8Array(jpeg), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": cache },
      });
    } catch {
      // Send the PNG instead.
    }
  }
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": cache },
  });
}
