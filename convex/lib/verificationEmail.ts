import { SITE_URL } from "../../lib/site";
import { escapeHtml, firstName, type BuiltEmail } from "./receiptEmail";

// The email that asks someone to confirm the address they signed up with. Pure,
// like the receipt: it takes what it needs and returns the subject, the HTML
// and the plain text, so it can be tested without sending anything.
//
// Two things in the wording matter. The link works for 24 hours, and the email
// says what to do if the person never made an account: don't click, ignore it.
// Someone else can type any address into a sign-up form, so this email will
// sometimes reach a person who has never heard of GoUplift.

export interface VerificationEmailData {
  // The name on the account, of which only the first word is used.
  userName: string | null;
  // The link that confirms the address, made by better-auth.
  url: string;
}

const BRAND_DARK = "#072b19";
const BRAND_GREEN = "#09cc60";
const TEXT = "#1c1917";
const MUTED = "#79716b";
const BORDER = "#e7e5e4";

export const VERIFICATION_SUBJECT = "Confirm your GoUplift email address";

export function buildVerificationEmail(
  data: VerificationEmailData,
  options: { siteUrl?: string } = {},
): BuiltEmail {
  const base = (options.siteUrl ?? SITE_URL).replace(/\/+$/, "");
  const helpUrl = `${base}/help`;
  const name = firstName(data.userName);
  const hello = name ? `Hello ${name},` : "Hello,";

  const lead =
    "Thanks for joining GoUplift. Please confirm that this email address is yours.";
  const why =
    "You need to confirm it before you can request a withdrawal or add a payout account.";
  const expiry = "This link works for 24 hours.";
  const ignore =
    "If you didn't create a GoUplift account, please ignore this email and don't click the button.";

  const text = [
    hello,
    "",
    lead,
    "",
    `Confirm my email: ${data.url}`,
    "",
    why,
    expiry,
    "",
    ignore,
    `Questions? ${helpUrl}`,
    "",
    "GoUplift",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(VERIFICATION_SUBJECT)}</title>
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
                <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${TEXT};">${escapeHtml(lead)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px 28px;">
                <a href="${escapeHtml(data.url)}" style="display:inline-block;background:${BRAND_DARK};color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold;padding:12px 20px;border-radius:8px;">Confirm my email</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0 28px;font-size:14px;line-height:21px;color:${TEXT};">${escapeHtml(why)} ${escapeHtml(expiry)}</td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0 28px;font-size:13px;line-height:20px;color:${MUTED};">If the button doesn't work, copy this address into your browser:<br /><span style="word-break:break-all;">${escapeHtml(data.url)}</span></td>
            </tr>
            <tr>
              <td style="padding:24px 28px 24px 28px;">
                <div style="border-top:1px solid ${BORDER};padding-top:16px;font-size:12px;line-height:18px;color:${MUTED};">
                  ${escapeHtml(ignore)}<br />
                  <a href="${escapeHtml(helpUrl)}" style="color:${MUTED};">Help</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: VERIFICATION_SUBJECT, html, text };
}
