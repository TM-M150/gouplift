// Shown to organizations as the way to check that a request really came from
// GoUplift. It is plain Node with no dependencies so it can be pasted in, and
// it is kept as a real module (not just text in a component) so it can be run
// against a known signature: a sample that doesn't work is worse than none.

export const NODE_VERIFY_SAMPLE = `import crypto from "node:crypto";

// rawBody must be the request body exactly as received (a string or Buffer),
// before any JSON parsing: the signature covers those exact bytes.
export function verifyGoUpliftSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(",")) {
    const [name, value] = part.trim().split("=");
    if (name === "t") timestamp = Number(value);
    if (name === "v1" && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  // Reject old requests so a captured one can't be replayed later.
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret) // the whsec_... string, exactly as shown
    .update(timestamp + "." + rawBody)
    .digest("hex");

  return signatures.some(
    (candidate) =>
      candidate.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)),
  );
}`;

export const EXPRESS_SAMPLE = `import express from "express";

const app = express();

// Use the raw body for this route; express.json() would re-serialise it.
app.post("/gouplift-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const ok = verifyGoUpliftSignature(
    req.body.toString("utf8"),
    req.get("GoUplift-Signature") ?? "",
    process.env.GOUPLIFT_WEBHOOK_SECRET,
  );
  if (!ok) return res.sendStatus(400);

  const event = JSON.parse(req.body.toString("utf8"));
  // Events can be delivered more than once: skip ones whose event.id you've seen.
  if (event.type === "donation.completed") {
    // event.data.donation.amount, .currency, .fundraiserId, ...
  }
  res.sendStatus(200); // any 2xx means "received"
});`;

export const EXAMPLE_EVENT = `{
  "id": "evt_donation_completed_k57abc123",
  "type": "donation.completed",
  "createdAt": "2026-10-31T09:15:02.000Z",
  "data": {
    "donation": {
      "id": "k57abc123",
      "fundraiserId": "k17def456",
      "organizationId": "jd2ghi789",
      "amount": 1000,
      "currency": "KES",
      "source": "EMBED",
      "isAnonymous": false,
      "donorName": "Amina Wanjiru",
      "message": "God bless this work",
      "completedAt": "2026-10-31T09:15:01.000Z"
    }
  }
}`;
