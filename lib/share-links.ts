// The links and the message behind the share buttons on a fundraiser page.
// Kept here, not in the button component, so that what actually gets sent to
// WhatsApp and the others can be tested.

/** The longest title put in a shared message, in characters. */
export const SHARE_TITLE_MAX_LENGTH = 80;

function shortTitle(title: string): string {
  const tidy = title.replace(/\s+/g, " ").trim();
  const letters = Array.from(tidy);
  if (letters.length <= SHARE_TITLE_MAX_LENGTH) return tidy;
  return `${letters
    .slice(0, SHARE_TITLE_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * The words that go with the link, as they read in a WhatsApp chat. The link
 * itself brings its own preview (the photo and the title) from the page.
 */
export function shareMessage(title: string): string {
  return `Please support “${shortTitle(title)}” on GoUplift:`;
}

/** Opens WhatsApp with the message and the link ready to send to someone. */
export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${shareMessage(title)} ${url}`)}`;
}

export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

export function xShareUrl(title: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(shareMessage(title))}&url=${encodeURIComponent(url)}`;
}

// A draft, a fundraiser waiting for review and a rejected one are not public.
const NOT_PUBLIC_STATUSES = new Set(["DRAFT", "PENDING_REVIEW", "REJECTED"]);

/**
 * Whether to offer share buttons at all. Only a fundraiser that anyone can
 * open: sharing the link to a private, suspended or not-yet-approved one would
 * send people to a page that says it doesn't exist.
 */
export function canShareFundraiser(fundraiser: {
  status: string;
  isPrivate?: boolean;
  isFlagged?: boolean;
}): boolean {
  return (
    !fundraiser.isPrivate &&
    !fundraiser.isFlagged &&
    !NOT_PUBLIC_STATUSES.has(fundraiser.status)
  );
}
