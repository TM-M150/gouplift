// The picture that shows when a link to a fundraiser is pasted into WhatsApp,
// Facebook, X or a message: one wide card (a photo, the title, how much has
// been raised and a progress bar). The picture itself is drawn by
// app/(dashboard)/fundraiser/[id]/share-image/route.tsx; the rules for what it
// says live here, apart from it, so they can be tested without drawing
// anything.

/**
 * 1.91 to 1, the shape every link preview is made for. A card of any other
 * shape, a phone photo for one, is shown narrow or cropped.
 */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * Where the card for a fundraiser is served from. The address carries the
 * things the card shows (when the fundraiser last changed, how much it has
 * raised and how many have given), so a new total is a new address and no
 * cache, ours or WhatsApp's, can hand out the old picture for it.
 */
export function shareCardPath(fundraiser: {
  _id: string;
  updatedAt: number;
  amountRaised: number;
  donorCount: number;
}): string {
  const version = [
    fundraiser.updatedAt,
    Math.round(fundraiser.amountRaised),
    fundraiser.donorCount,
  ].join("-");
  return `/fundraiser/${encodeURIComponent(fundraiser._id)}/share-image?v=${version}`;
}

export type ShareCardFigures = {
  /** The big number: what has been raised, or the goal until anyone has given. */
  headline: string;
  /** What the headline is: "raised of Ksh 400,000", or "goal". */
  caption: string;
  /** What the bar shows, 0 to 100. A fundraiser past its goal fills it. */
  barPercent: number;
  /** "46% funded", or the real figure once the goal has been passed. */
  status: string;
  /** "61 donations"; nothing before the first one. */
  donations: string | null;
};

function money(amount: number, currency: "KES" | "USD"): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * What the card says about the money, from the fundraiser's own numbers. A
 * fundraiser nobody has given to yet leads with its goal and an invitation, not
 * with "Ksh 0 raised".
 */
export function shareCardFigures(input: {
  amountRaised: number;
  goalAmount: number;
  donorCount: number;
  currency: "KES" | "USD";
}): ShareCardFigures {
  const raised = Math.max(0, input.amountRaised);
  const count = Math.max(0, Math.round(input.donorCount));
  const goal = money(input.goalAmount, input.currency);

  if (raised === 0 && count === 0) {
    return {
      headline: goal,
      caption: "goal",
      barPercent: 0,
      status: "Be the first to give",
      donations: null,
    };
  }

  const percent =
    input.goalAmount > 0 ? Math.round((raised / input.goalAmount) * 100) : 0;

  return {
    headline: money(raised, input.currency),
    caption: `raised of ${goal}`,
    // A gift too small to move the bar still shows a sliver of it, so the bar
    // never reads as empty once there is something in it.
    barPercent: raised > 0 ? Math.min(100, Math.max(percent, 3)) : 0,
    status:
      raised > 0 && percent === 0
        ? "Under 1% funded"
        : `${percent.toLocaleString("en-KE")}% funded`,
    donations: `${count.toLocaleString("en-KE")} ${count === 1 ? "donation" : "donations"}`,
  };
}

/**
 * How large the title can be set and still fit in three lines of the card's
 * text column. Longer titles get smaller type; the very longest are cut with
 * "…" by the card itself.
 */
export function shareCardTitleSize(title: string): number {
  const length = Array.from(title.trim()).length;
  if (length <= 34) return 62;
  if (length <= 52) return 52;
  if (length <= 66) return 46;
  return 40;
}

const TYPE_LABELS: Record<string, string> = {
  MEDICAL: "Medical",
  EDUCATION: "Education",
  EMERGENCY: "Emergency",
  MEMORIAL_FUNERAL: "Memorial and funeral",
  COMMUNITY_HARAMBEE: "Community harambee",
  BUSINESS_STARTUP: "Business",
  SPORTS: "Sports",
  CREATIVE_ARTS: "Creative arts",
  ANIMAL_WELFARE: "Animal welfare",
  ENVIRONMENT: "Environment",
  DISASTER_RELIEF: "Disaster relief",
  NONPROFIT: "Nonprofit",
  OTHER: "Fundraiser",
};

/** "Medical · Kajiado": the kind of fundraiser and where, when it says. */
export function shareCardKind(input: {
  type: string;
  location?: string | null;
}): string {
  const label = TYPE_LABELS[input.type] ?? "Fundraiser";
  const place = input.location?.replace(/\s+/g, " ").trim();
  return place ? `${label} · ${place}` : label;
}

/**
 * Longest words of a title, cut so one long word can't push the layout around:
 * a "word" over this many characters is broken by the card.
 */
export const SHARE_CARD_MAX_TITLE_CHARS = 140;

/** The title as the card sets it: squeezed onto one line of text and capped. */
export function shareCardTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length <= SHARE_CARD_MAX_TITLE_CHARS
    ? flat
    : `${chars
        .slice(0, SHARE_CARD_MAX_TITLE_CHARS - 1)
        .join("")
        .trimEnd()}…`;
}
