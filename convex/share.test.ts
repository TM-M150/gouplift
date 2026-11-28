import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  canOptimizeImage,
  OPTIMIZABLE_IMAGE_HOSTS,
  shareDescription,
  shareImage,
  shareMetadata,
  SHARE_DESCRIPTION_LENGTH,
} from "../lib/share";
import { SHARE_CARD_SIZE } from "../lib/share-card";
import { SHARE_IMAGE, SITE_NAME, SITE_URL } from "../lib/site";

const STORED = "https://happy-animal-123.convex.cloud/api/storage/abc-def";

describe("which pictures can be used in a link preview", () => {
  it("accepts a stored upload and an Unsplash photo", () => {
    expect(canOptimizeImage(STORED)).toBe(true);
    expect(canOptimizeImage("https://images.unsplash.com/photo-1?w=900")).toBe(
      true,
    );
  });

  it("refuses a picture from anywhere else, and anything that isn't a plain https link", () => {
    for (const src of [
      "https://example.com/cover.jpg",
      "http://happy-animal-123.convex.cloud/api/storage/abc",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/relative/cover.jpg",
      "not a url",
      "",
    ]) {
      expect(canOptimizeImage(src), src).toBe(false);
    }
  });

  it("is not fooled by a host that only looks like ours", () => {
    for (const src of [
      "https://convex.cloud/api/storage/abc",
      "https://convex.cloud.evil.example/api/storage/abc",
      "https://evil-convex.cloud/api/storage/abc",
      "https://evil.example/.convex.cloud/x.jpg",
      "https://happy-animal-123.convex.cloud@evil.example/x.jpg",
      // One part of a host name, like the `*` in next.config.ts: two would be
      // turned away by the optimizer, and the preview would have no picture.
      "https://a.b.convex.cloud/api/storage/abc",
    ]) {
      expect(canOptimizeImage(src), src).toBe(false);
    }
  });

  it("only offers hosts that next.config.ts lets the optimizer fetch from", () => {
    const allowed = (nextConfig.images?.remotePatterns ?? [])
      .filter(
        (pattern) => "hostname" in pattern && pattern.protocol === "https",
      )
      .map((pattern) => pattern.hostname);

    for (const host of OPTIMIZABLE_IMAGE_HOSTS) {
      expect(allowed, host).toContain(host);
    }
  });
});

describe("the picture in a link preview", () => {
  it("is the page's own picture, resized by our optimizer to a size Next.js allows", () => {
    const image = shareImage([STORED], "Water for Kajiado");

    const url = new URL(image.url, SITE_URL);
    expect(url.pathname).toBe("/_next/image");
    expect(url.searchParams.get("url")).toBe(STORED);
    // 1200 is among the default deviceSizes and 75 the default quality.
    expect(url.searchParams.get("w")).toBe("1200");
    expect(url.searchParams.get("q")).toBe("75");
    expect(image.alt).toBe("Water for Kajiado");
  });

  it("is never the original upload, which could be many megabytes", () => {
    expect(shareImage([STORED], "x").url).not.toBe(STORED);
  });

  it("is the GoUplift logo card when the page has no picture", () => {
    for (const none of [[], [null], [undefined], [""], [null, undefined]]) {
      expect(shareImage(none, "Water for Kajiado")).toEqual(SHARE_IMAGE);
    }
  });

  it("is the logo card when the only picture is from somewhere it can't be fetched", () => {
    expect(shareImage(["https://example.com/cover.jpg"], "x")).toEqual(
      SHARE_IMAGE,
    );
  });

  it("takes the first picture that can be used, not just the first one", () => {
    const image = shareImage(
      [null, "https://example.com/banner.jpg", STORED],
      "x",
    );
    expect(new URL(image.url, SITE_URL).searchParams.get("url")).toBe(STORED);
  });

  it("keeps a picture whose address has characters of its own intact", () => {
    const odd = "https://happy-animal-123.convex.cloud/a b/c?d=1&e=é#f";
    const image = shareImage([odd], "x");
    expect(new URL(image.url, SITE_URL).searchParams.get("url")).toBe(odd);
    // And they can't add parameters of their own to our request.
    expect([...new URL(image.url, SITE_URL).searchParams.keys()]).toEqual([
      "url",
      "w",
      "q",
    ]);
  });

  it("does not hand out the logo card's own object to be changed", () => {
    const image = shareImage([], "x");
    expect(image).not.toBe(SHARE_IMAGE);
  });
});

describe("the description in a link preview", () => {
  it("is the first one that has something in it", () => {
    expect(
      shareDescription([null, "", "   ", "The tagline", "The story"], "f"),
    ).toBe("The tagline");
  });

  it("uses the fallback when there is nothing", () => {
    expect(shareDescription([], "Support this fundraiser.")).toBe(
      "Support this fundraiser.",
    );
    expect(shareDescription([null, undefined, " \n "], "Support.")).toBe(
      "Support.",
    );
  });

  it("is one tidy line, however the story was typed", () => {
    expect(
      shareDescription(
        ["  Line one.\n\n\nLine   two.\r\n\tLine three.  "],
        "f",
      ),
    ).toBe("Line one. Line two. Line three.");
  });

  it("is left alone when it fits", () => {
    const exact = "a".repeat(SHARE_DESCRIPTION_LENGTH);
    expect(shareDescription([exact], "f")).toBe(exact);
  });

  it("is cut at a word, with an ellipsis, when it is too long", () => {
    const story = "word ".repeat(100);
    const result = shareDescription([story], "f");
    expect(result.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_LENGTH);
    expect(result.endsWith("word…")).toBe(true);
    expect(result).not.toMatch(/\s…$/);
  });

  it("is cut mid-word only when one word runs on and on", () => {
    const result = shareDescription(["x".repeat(500)], "f");
    expect(Array.from(result)).toHaveLength(SHARE_DESCRIPTION_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  it("never cuts a character in half", () => {
    // Each emoji is two UTF-16 units; cutting between them leaves half a
    // character that shows as a broken symbol.
    const result = shareDescription(["🙏".repeat(300)], "f");
    expect(Array.from(result)).toHaveLength(SHARE_DESCRIPTION_LENGTH);
    expect(result).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(result).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });
});

describe("a page's share metadata", () => {
  const meta = shareMetadata({
    path: "/fundraiser/k17abc",
    title: "Water for Kajiado",
    description: "Clean water for 400 families.",
    images: [STORED],
    imageAlt: "Water for Kajiado",
  });

  it("has a canonical address of its own, in full and without a query string", () => {
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/fundraiser/k17abc`);
    expect(String(meta.alternates?.canonical)).not.toContain("?");
    expect(meta.openGraph?.url).toBe(`${SITE_URL}/fundraiser/k17abc`);
  });

  it("gives the tab, WhatsApp and Facebook, and X the same title, description and picture", () => {
    expect(meta.title).toBe("Water for Kajiado");
    expect(meta.description).toBe("Clean water for 400 families.");
    expect(meta.openGraph).toMatchObject({
      title: "Water for Kajiado",
      description: "Clean water for 400 families.",
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Water for Kajiado",
      description: "Clean water for 400 families.",
    });
    expect(meta.openGraph?.images).toEqual(meta.twitter?.images);
    expect(meta.openGraph?.images).toHaveLength(1);
  });

  it("says who it is from, because it replaces the site-wide defaults", () => {
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: SITE_NAME,
      locale: "en_KE",
    });
  });

  it("can show a shorter title in the preview than in the tab", () => {
    const org = shareMetadata({
      path: "/organizations/tumaini",
      title: "Tumaini Trust | GoUplift",
      shareTitle: "Tumaini Trust",
      description: "d",
      images: [],
      imageAlt: "Tumaini Trust",
    });
    expect(org.title).toBe("Tumaini Trust | GoUplift");
    expect(org.openGraph?.title).toBe("Tumaini Trust");
    expect(org.twitter?.title).toBe("Tumaini Trust");
  });

  it("can use a card drawn for the page, at the size it is drawn, instead of the page's own pictures", () => {
    const fundraiser = shareMetadata({
      path: "/fundraiser/k17abc",
      title: "Water for Kajiado",
      description: "d",
      images: [STORED],
      card: "/fundraiser/k17abc/share-image?v=1-100-2",
      imageAlt: "Water for Kajiado: Ksh 100 raised of Ksh 400,000",
    });
    const expected = [
      {
        url: "/fundraiser/k17abc/share-image?v=1-100-2",
        alt: "Water for Kajiado: Ksh 100 raised of Ksh 400,000",
        width: SHARE_CARD_SIZE.width,
        height: SHARE_CARD_SIZE.height,
      },
    ];
    expect(fundraiser.openGraph?.images).toEqual(expected);
    expect(fundraiser.twitter?.images).toEqual(expected);
  });

  it("needs no list of pictures when it has a card", () => {
    const withCard = shareMetadata({
      path: "/fundraiser/k17abc",
      title: "t",
      description: "d",
      card: "/fundraiser/k17abc/share-image",
      imageAlt: "t",
    });
    expect(withCard.openGraph?.images).toHaveLength(1);
  });

  it("falls back to the logo card, with its own words for it, when there is no picture", () => {
    const bare = shareMetadata({
      path: "/organizations/tumaini",
      title: "Tumaini Trust | GoUplift",
      description: "d",
      images: [null],
      imageAlt: "Tumaini Trust",
    });
    expect(bare.openGraph?.images).toEqual([SHARE_IMAGE]);
    expect(bare.twitter?.images).toEqual([SHARE_IMAGE]);
  });
});
