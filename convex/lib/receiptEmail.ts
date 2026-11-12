import { SITE_URL } from "../../lib/site";

// The donation receipt, as an email. Pure: it takes what happened and returns
// the subject, the HTML and the plain-text version, so it can be tested and
// looked at without sending anything.
//
// Everything that came from a person (their name, the fundraiser's title) is
// escaped before it goes into the HTML, and kept to one line in the subject.

export interface ReceiptData {
  donationId: string;
  // What the donor typed, if anything. Receipts go only to the donor, so this
  // is used even for an anonymous donation: anonymous means hidden from the
  // public, not from the person who gave.
  donorName: string | null;
  isAnonymous: boolean;
  fundraiserId: string;
  fundraiserTitle: string;
  // All in KES, as stored.
  grossAmount: number;
  platformFeeRate: number;
  platformFeeAmount: number;
  netAmount: number;
  // What the donor was actually charged, when it wasn't shillings.
  originalCurrency: "KES" | "USD" | null;
  originalAmount: number | null;
  exchangeRate: number | null;
  provider: "SASAPAY" | "PAYPAL" | null;
  paymentMethod:
    | "SASAPAY_WALLET"
    | "MPESA"
    | "AIRTEL_MONEY"
    | "CARD"
    | "BANK"
    | "PAYPAL"
    | null;
  // The M-Pesa or SasaPay code, or the PayPal transaction id.
  reference: string | null;
  isMonthly: boolean;
  completedAt: number;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND_DARK = "#072b19";
const BRAND_GREEN = "#09cc60";
const TEXT = "#1c1917";
const MUTED = "#79716b";
const BORDER = "#e7e5e4";

const METHOD_LABELS: Record<NonNullable<ReceiptData["paymentMethod"]>, string> =
  {
    SASAPAY_WALLET: "SasaPay wallet",
    MPESA: "M-Pesa",
    AIRTEL_MONEY: "Airtel Money",
    CARD: "Card",
    BANK: "Bank",
    PAYPAL: "PayPal",
  };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Kenya is UTC+3 all year, with no daylight saving.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "12 Nov 2026, 05:49 EAT". Worked out by hand, so it doesn't depend on the runtime's time zone data. */
export function formatReceiptDate(ms: number): string {
  const d = new Date(ms + EAT_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} EAT`;
}

/** 1300 → "1,300", 1244.75 → "1,244.75". Whole amounts have no decimals. */
function amount(n: number): string {
  const [whole, cents] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? grouped : `${grouped}.${cents}`;
}

export const kes = (n: number) => `KES ${amount(n)}`;
const usd = (n: number) => `USD ${(Math.round(n * 100) / 100).toFixed(2)}`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A header can't contain a line break, and a long title would push the amount
// out of the preview.
function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A quick shape check so an obvious typo isn't sent to Resend. Resend does the real validation. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length <= 254;
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? oneLine(first, 40) : null;
}

type Row = readonly [label: string, value: string];

function detailRows(data: ReceiptData): Row[] {
  const rows: Row[] = [["Date", formatReceiptDate(data.completedAt)]];

  if (data.originalCurrency === "USD" && data.originalAmount !== null) {
    rows.push(["You paid", usd(data.originalAmount)]);
    if (data.exchangeRate !== null) {
      rows.push(["Exchange rate", `KES ${amount(data.exchangeRate)} per US dollar`]);
    }
    rows.push(["Amount in shillings", kes(data.grossAmount)]);
  } else {
    rows.push(["Amount", kes(data.grossAmount)]);
  }

  const method = data.paymentMethod ?? (data.provider === "PAYPAL" ? "PAYPAL" : null);
  if (method) rows.push(["Paid with", METHOD_LABELS[method]]);
  if (data.isMonthly) rows.push(["Type", "Monthly gift"]);
  if (data.reference) {
    rows.push([
      data.provider === "PAYPAL" ? "PayPal transaction ID" : "Payment reference",
      data.reference,
    ]);
  }

  const percent = Number((data.platformFeeRate * 100).toFixed(2));
  rows.push([`GoUplift platform fee (${percent}%)`, kes(data.platformFeeAmount)]);
  rows.push(["Goes to the fundraiser", kes(data.netAmount)]);
  if (data.isAnonymous) {
    rows.push(["Shown publicly as", "Anonymous"]);
  }
  return rows;
}

export function buildReceiptEmail(
  data: ReceiptData,
  siteUrl: string = SITE_URL,
): BuiltEmail {
  const base = siteUrl.replace(/\/+$/, "");
  const fundraiserUrl = `${base}/fundraiser/${data.fundraiserId}`;
  const helpUrl = `${base}/help`;
  const title = oneLine(data.fundraiserTitle, 120) || "a fundraiser";
  const total = kes(data.grossAmount);
  const name = firstName(data.donorName);
  const rows = detailRows(data);

  const subject = `Your GoUplift receipt: ${total} to ${oneLine(title, 60)}`;

  const thanks = data.isMonthly
    ? "Thank you for your monthly gift."
    : "Thank you for your donation.";
  const monthlyNote = data.isMonthly
    ? "This gift repeats every month. You'll get a receipt each time, and you can cancel from your PayPal account whenever you like."
    : null;

  // ---- Plain text ---------------------------------------------------------
  const text = [
    name ? `Hello ${name},` : "Hello,",
    "",
    `${thanks} Here is your receipt for ${total} to "${title}".`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    ...(monthlyNote ? [monthlyNote, ""] : []),
    `See the fundraiser: ${fundraiserUrl}`,
    "",
    "Keep this email as your record of the donation.",
    `Questions? ${helpUrl}`,
    "",
    `Donation ID: ${data.donationId}`,
    "GoUplift",
  ].join("\n");

  // ---- HTML ---------------------------------------------------------------
  const rowHtml = rows
    .map(
      ([label, value], index) => `
              <tr>
                <td style="padding:10px 0;${index > 0 ? `border-top:1px solid ${BORDER};` : ""}font-size:14px;line-height:20px;color:${MUTED};vertical-align:top;">${escapeHtml(label)}</td>
                <td align="right" style="padding:10px 0 10px 16px;${index > 0 ? `border-top:1px solid ${BORDER};` : ""}font-size:14px;line-height:20px;color:${TEXT};vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td>
              </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(thanks)} ${escapeHtml(total)} to ${escapeHtml(title)}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
            <tr>
              <td style="background:${BRAND_DARK};padding:20px 28px;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:0.5px;color:#ffffff;">GO<span style="color:${BRAND_GREEN};">UPLIFT</span></td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <p style="margin:0 0 4px 0;font-size:15px;line-height:22px;color:${MUTED};">${name ? `Hello ${escapeHtml(name)},` : "Hello,"}</p>
                <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${TEXT};">${escapeHtml(thanks)} Here is your receipt.</p>
                <p style="margin:0;font-size:32px;line-height:40px;font-weight:bold;color:${BRAND_DARK};">${escapeHtml(total)}</p>
                <p style="margin:4px 0 0 0;font-size:15px;line-height:22px;color:${TEXT};">to <a href="${escapeHtml(fundraiserUrl)}" style="color:${BRAND_DARK};font-weight:bold;">${escapeHtml(title)}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}
                </table>
              </td>
            </tr>${
              monthlyNote
                ? `
            <tr>
              <td style="padding:8px 28px 0 28px;font-size:14px;line-height:21px;color:${TEXT};">${escapeHtml(monthlyNote)}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <a href="${escapeHtml(fundraiserUrl)}" style="display:inline-block;background:${BRAND_DARK};color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold;padding:12px 20px;border-radius:8px;">See the fundraiser</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px 28px;border-top:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};">
                Keep this email as your record of the donation. Questions? Visit our <a href="${escapeHtml(helpUrl)}" style="color:${MUTED};">help page</a>.<br />
                Donation ID: ${escapeHtml(data.donationId)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
