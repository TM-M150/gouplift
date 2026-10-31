// Every webhook request carries
//
//   GoUplift-Signature: t=<unix seconds>,v1=<hex>
//
// where v1 is HMAC-SHA256 of "<t>.<raw request body>", keyed with the
// endpoint's signing secret (the whole "whsec_..." string, as shown). The
// timestamp is inside the signed text so a captured request can't be replayed
// later: receivers should reject anything older than a few minutes.

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hmacHex(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  return toHex(mac);
}

export async function buildSignatureHeader(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, timestamp, body)}`;
}

// Compares without stopping at the first difference, so response time doesn't
// reveal how much of a guess was right.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

// The receiving side of the scheme above. We don't call it ourselves; it is
// here so the documented algorithm is one that is tested, and so the same
// code can be copied into a receiver.
export async function verifySignatureHeader(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const [name, value] = part.trim().split("=");
    if (name === "t" && value && /^\d{1,12}$/.test(value)) {
      timestamp = Number(value);
    } else if (name === "v1" && value) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = await hmacHex(secret, timestamp, body);
  return signatures.some((candidate) => constantTimeEqual(candidate, expected));
}

// 32 random bytes from the platform's secure generator. Only ever called from
// actions; the value is shown to the owner once and stored to sign with.
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  const base64url = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `whsec_${base64url}`;
}
