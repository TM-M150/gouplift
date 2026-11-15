import { SITE_URL } from "../../lib/site";
import { escapeHtml, kes, type BuiltEmail } from "./receiptEmail";

// The email donors get when the fundraiser they gave to posts an update. Pure,
// like the receipt: it takes what it needs and returns the subject, the HTML,
// the plain text and the headers, so it can be tested without sending.
//
// It deliberately does not contain the update. The update is text the creator
// typed, and an email from GoUplift carries our name: a scammer's "send the
// rest to this number" would arrive looking as trustworthy as a receipt. So
// the email holds only what staff have already reviewed (the fundraiser's
// title) and the fundraiser's totals, and sends the reader to the page, which
// is also where we want them: that is where they can give again.

/** Donors looked at per step of the fan-out. Each step schedules at most this many sends. */
export const FANOUT_PAGE_SIZE = 100;

/**
 * Gap between one send and the next. Resend's default is two requests a
 * second, and a send that goes over comes back as a retry, so this keeps a
 * large fundraiser's emails going out steadily instead of in a burst that
 * mostly fails and retries. A thousand donors take about ten minutes.
 */
export const SEND_SPACING_MS = 600;

/** A runaway guard: no single update is ever emailed to more donors than this. */
export const MAX_RECIPIENTS_PER_UPDATE = 10_000;

export interface UpdateEmailData {
  fundraiserId: string;
  fundraiserTitle: string;
  amountRaised: number;
  goalAmount: number;
  currency: "KES" | "USD";
  // Whether the fundraiser can still take donations.
  isOpen: boolean;
  // The recipient's unsubscribe token.
  token: string;
}

export interface BuiltUpdateEmail extends BuiltEmail {
  headers: Record<string, string>;
}

const BRAND_DARK = "#072b19";
const BRAND_GREEN = "#09cc60";
const TEXT = "#1c1917";
const MUTED = "#79716b";
const BORDER = "#e7e5e4";

// A header can't contain a line break, and a long title would push the rest
// out of the preview.
function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * `oneClickUrl` is where a mail app can POST to unsubscribe without opening
 * anything (RFC 8058). Without it, only the link in the email is offered.
 */
export function buildUpdateEmail(
  data: UpdateEmailData,
  options: { siteUrl?: string; oneClickUrl?: string | null } = {},
): BuiltUpdateEmail {
  const base = (options.siteUrl ?? SITE_URL).replace(/\/+$/, "");
  const readUrl = `${base}/fundraiser/${data.fundraiserId}#updates`;
  const unsubscribeUrl = `${base}/unsubscribe/${data.token}`;
  const helpUrl = `${base}/help`;
  const title = oneLine(data.fundraiserTitle, 120) || "a fundraiser";

  const subject = `New update on ${oneLine(title, 70)}`;
  const lead = `The organizer of "${title}", a fundraiser you gave to, has posted an update.`;

  // Only in shillings, which is how the fundraiser page shows it too.
  const progress =
    data.currency === "KES" && data.goalAmount > 0
      ? `${kes(data.amountRaised)} raised of ${kes(data.goalAmount)}`
      : null;
  const percent =
    progress === null
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round((data.amountRaised / data.goalAmount) * 100),
          ),
        );
  const nudge = data.isOpen
    ? "It is still open, if you would like to give again or share it."
    : null;

  const text = [
    "Hello,",
    "",
    lead,
    ...(progress ? ["", progress] : []),
    "",
    `Read the update: ${readUrl}`,
    ...(nudge ? ["", nudge] : []),
    "",
    "You are getting this because you donated to this fundraiser on GoUplift.",
    `Stop emails about this fundraiser: ${unsubscribeUrl}`,
    `Questions? ${helpUrl}`,
    "",
    "GoUplift",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(lead)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
            <tr>
              <td style="background:${BRAND_DARK};padding:20px 28px;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:0.5px;color:#ffffff;">GO<span style="color:${BRAND_GREEN};">UPLIFT</span></td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <p style="margin:0 0 4px 0;font-size:15px;line-height:22px;color:${MUTED};">Hello,</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${TEXT};">The organizer of <a href="${escapeHtml(`${base}/fundraiser/${data.fundraiserId}`)}" style="color:${BRAND_DARK};font-weight:bold;">${escapeHtml(title)}</a>, a fundraiser you gave to, has posted an update.</p>${
                  progress
                    ? `
                <p style="margin:0 0 8px 0;font-size:15px;line-height:22px;color:${TEXT};">${escapeHtml(progress)}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;"><tr>
                  <td style="background:${BORDER};border-radius:4px;height:8px;line-height:8px;font-size:0;"><table role="presentation" width="${percent}%" cellpadding="0" cellspacing="0"><tr><td style="background:${BRAND_GREEN};border-radius:4px;height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr></table></td>
                </tr></table>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px 28px;">
                <a href="${escapeHtml(readUrl)}" style="display:inline-block;background:${BRAND_DARK};color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold;padding:12px 20px;border-radius:8px;">Read the update</a>
              </td>
            </tr>${
              nudge
                ? `
            <tr>
              <td style="padding:12px 28px 0 28px;font-size:14px;line-height:21px;color:${TEXT};">${escapeHtml(nudge)}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:24px 28px 24px 28px;">
                <div style="border-top:1px solid ${BORDER};padding-top:16px;font-size:12px;line-height:18px;color:${MUTED};">
                  You are getting this because you donated to this fundraiser on GoUplift.<br />
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};">Stop emails about this fundraiser</a> · <a href="${escapeHtml(helpUrl)}" style="color:${MUTED};">Help</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const headers: Record<string, string> = {};
  if (options.oneClickUrl) {
    headers["List-Unsubscribe"] = `<${options.oneClickUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return { subject, html, text, headers };
}
