import { describe, expect, it } from "vitest";
import {
  canShareFundraiser,
  facebookShareUrl,
  SHARE_TITLE_MAX_LENGTH,
  shareMessage,
  whatsappShareUrl,
  xShareUrl,
} from "./share-links";

const URL_ = "https://www.gouplift.africa/fundraiser/jh7abc123";

// What WhatsApp, Facebook and X will receive, read back out of the link.
const textOf = (link: string, key = "text") =>
  new URL(link).searchParams.get(key);

describe("shareMessage", () => {
  it("names the fundraiser and GoUplift", () => {
    expect(shareMessage("Water for Kajiado")).toBe(
      "Please support “Water for Kajiado” on GoUplift:",
    );
  });

  it("tidies the title's spacing", () => {
    expect(shareMessage("  Water \n for   Kajiado ")).toBe(
      "Please support “Water for Kajiado” on GoUplift:",
    );
  });

  it("cuts a very long title, not in the middle of an emoji", () => {
    const message = shareMessage("😀".repeat(300));
    const title = message.slice(message.indexOf("“") + 1, message.indexOf("”"));
    expect(Array.from(title)).toHaveLength(SHARE_TITLE_MAX_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("�");
  });

  it("keeps a title that fits as it is", () => {
    const title = "x".repeat(SHARE_TITLE_MAX_LENGTH);
    expect(shareMessage(title)).toContain(`“${title}”`);
  });
});

describe("whatsappShareUrl", () => {
  it("opens WhatsApp with the message and the link", () => {
    const link = whatsappShareUrl("Water for Kajiado", URL_);
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(textOf(link)).toBe(
      `Please support “Water for Kajiado” on GoUplift: ${URL_}`,
    );
  });

  // A title with & ? # = or a quote must not break the link or add a
  // parameter of its own.
  it("survives a title full of characters that mean something in a link", () => {
    const title = `Tom & Jerry's "school fees"? #1 fund=100%`;
    const link = whatsappShareUrl(title, URL_);
    expect(new URL(link).searchParams.getAll("text")).toHaveLength(1);
    expect([...new URL(link).searchParams.keys()]).toEqual(["text"]);
    expect(textOf(link)).toContain(`“${title}”`);
    expect(textOf(link)?.endsWith(URL_)).toBe(true);
  });

  it("carries the whole link, with nothing cut or changed", () => {
    expect(textOf(whatsappShareUrl("t", URL_))?.endsWith(URL_)).toBe(true);
  });
});

describe("facebookShareUrl", () => {
  it("shares just the link", () => {
    const link = facebookShareUrl(URL_);
    expect(link.startsWith("https://www.facebook.com/sharer/sharer.php?")).toBe(
      true,
    );
    expect(textOf(link, "u")).toBe(URL_);
  });
});

describe("xShareUrl", () => {
  it("shares the message and the link as separate parts", () => {
    const link = xShareUrl("Water for Kajiado", URL_);
    expect(link.startsWith("https://x.com/intent/post?")).toBe(true);
    expect(textOf(link)).toBe(
      "Please support “Water for Kajiado” on GoUplift:",
    );
    expect(textOf(link, "url")).toBe(URL_);
  });
});

describe("canShareFundraiser", () => {
  it.each(["ACTIVE", "PAUSED", "COMPLETED", "EXPIRED", "CANCELLED"])(
    "offers sharing for a public fundraiser that is %s",
    (status) => {
      expect(canShareFundraiser({ status })).toBe(true);
      expect(canShareFundraiser({ status, isPrivate: false })).toBe(true);
    },
  );

  it.each(["DRAFT", "PENDING_REVIEW", "REJECTED"])(
    "does not for one that is %s",
    (status) => {
      expect(canShareFundraiser({ status })).toBe(false);
    },
  );

  it("does not for a private fundraiser or a suspended one", () => {
    expect(canShareFundraiser({ status: "ACTIVE", isPrivate: true })).toBe(
      false,
    );
    expect(canShareFundraiser({ status: "ACTIVE", isFlagged: true })).toBe(
      false,
    );
  });
});
