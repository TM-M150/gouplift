import { REQUEST_TIMEOUT_MS } from "./webhookConfig";
import { buildSignatureHeader } from "./webhookSignature";
import type { WebhookError } from "./webhookValidators";

export type SendOutcome =
  | { kind: "success"; statusCode: number }
  | { kind: "failure"; error: WebhookError; statusCode?: number };

// One signed POST. Never throws: whatever goes wrong becomes an outcome the
// caller can record.
//
// Three deliberate limits, because the URL belongs to someone else:
//  - redirects are refused, so a validated address can't hand us on to an
//    unvalidated one;
//  - the response body is never read, stored or shown, only its status, so
//    the URL can't be used to read back what is behind it;
//  - the attempt is cut off after REQUEST_TIMEOUT_MS.
export async function sendWebhook(
  job: {
    url: string;
    secret: string;
    payload: string;
    eventId: string;
    eventType: string;
  },
  nowMs: number,
): Promise<SendOutcome> {
  const signature = await buildSignatureHeader(
    job.secret,
    Math.floor(nowMs / 1000),
    job.payload,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(job.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "GoUplift-Webhooks/1.0",
        "GoUplift-Event-Id": job.eventId,
        "GoUplift-Event-Type": job.eventType,
        "GoUplift-Signature": signature,
      },
      body: job.payload,
    });

    // Let go of the connection without reading what the receiver said.
    void response.body?.cancel().catch(() => undefined);

    if (response.status >= 200 && response.status < 300) {
      return { kind: "success", statusCode: response.status };
    }
    return {
      kind: "failure",
      error: "http_error",
      statusCode: response.status,
    };
  } catch {
    return {
      kind: "failure",
      error: controller.signal.aborted ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}
