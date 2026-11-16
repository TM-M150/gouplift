import { SITE_URL } from "../../lib/site";
import {
  escapeHtml,
  firstName,
  oneLine,
  type BuiltEmail,
} from "./receiptEmail";

// The email an organizer gets when donors have commented on their fundraiser.
// Pure, like the receipt: it takes what it needs and returns the subject, the
// HTML, the plain text and the headers, so it can be tested without sending.
//
// It deliberately says how many comments there are and nothing about what they
// say or who wrote them. A comment is text a stranger typed, and an email from
// GoUplift carries our name: it must not be a way for anyone to put their words
// into an organizer's inbox looking trustworthy. The words are on the page,
// which is also where the organizer can hide them.

export interface CommentEmailData {
  fundraiserId: string;
  fundraiserTitle: string;
  // The organizer's name, of which only the first word is used.
  organizerName: string | null;
  // How many new comments, and whether there were more than that.
  count: number;
  hasMore: boolean;
  // The recipient's unsubscribe token.
  token: string;
}

export interface BuiltCommentEmail extends BuiltEmail {
  headers: Record<string, string>;
}

const BRAND_DARK = "#072b19";
const BRAND_GREEN = "#09cc60";
const TEXT = "#1c1917";
const MUTED = "#79716b";
const BORDER = "#e7e5e4";

/** "1 new comment", "3 new comments", "100+ new comments". */
export function commentCountLabel(count: number, hasMore: boolean): string {
  if (hasMore) return `${count}+ new comments`;
  return count === 1 ? "1 new comment" : `${count} new comments`;
}

/**
 * `oneClickUrl` is where a mail app can POST to unsubscribe without opening
 * anything (RFC 8058). Without it, only the link in the email is offered.
 */
export function buildCommentEmail(
  data: CommentEmailData,
  options: { siteUrl?: string; oneClickUrl?: string | null } = {},
): BuiltCommentEmail {
  const base = (options.siteUrl ?? SITE_URL).replace(/\/+$/, "");
  const readUrl = `${base}/fundraiser/${data.fundraiserId}#comments`;
  const unsubscribeUrl = `${base}/unsubscribe/comments/${data.token}`;
  const helpUrl = `${base}/help`;
  const title = oneLine(data.fundraiserTitle, 120) || "your fundraiser";
  const name = firstName(data.organizerName);
  const hello = name ? `Hello ${name},` : "Hello,";
  const label = commentCountLabel(data.count, data.hasMore);

  const subject = `${label} on ${oneLine(title, 70)}`;
  const single = data.count === 1 && !data.hasMore;
  const lead = single
    ? `A donor has left a new comment on "${title}".`
    : `Donors have left ${label} on "${title}".`;
  const hideNote =
    "You can hide any comment from the fundraiser page if it doesn't belong there.";
  const reason =
    "You are getting this because you started this fundraiser on GoUplift. We send at most one of these a day for each fundraiser.";

  const text = [
    hello,
    "",
    lead,
    "",
    `Read the comments: ${readUrl}`,
    "",
    hideNote,
    "",
    reason,
    `Stop comment emails: ${unsubscribeUrl}`,
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
                <p style="margin:0 0 4px 0;font-size:15px;line-height:22px;color:${MUTED};">${escapeHtml(hello)}</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${TEXT};">${
                  single
                    ? "A donor has left a new comment on"
                    : `Donors have left ${escapeHtml(label)} on`
                } <a href="${escapeHtml(`${base}/fundraiser/${data.fundraiserId}`)}" style="color:${BRAND_DARK};font-weight:bold;">${escapeHtml(title)}</a>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px 28px;">
                <a href="${escapeHtml(readUrl)}" style="display:inline-block;background:${BRAND_DARK};color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold;padding:12px 20px;border-radius:8px;">Read the comments</a>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0 28px;font-size:14px;line-height:21px;color:${TEXT};">${escapeHtml(hideNote)}</td>
            </tr>
            <tr>
              <td style="padding:24px 28px 24px 28px;">
                <div style="border-top:1px solid ${BORDER};padding-top:16px;font-size:12px;line-height:18px;color:${MUTED};">
                  ${escapeHtml(reason)}<br />
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};">Stop comment emails</a> · <a href="${escapeHtml(helpUrl)}" style="color:${MUTED};">Help</a>
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
