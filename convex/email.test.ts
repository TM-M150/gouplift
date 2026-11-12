import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_FROM,
  EMAIL_RETRY_DELAYS_MS,
  MAX_EMAIL_ATTEMPTS,
  sendEmail,
} from "./lib/email";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const input = {
  to: "donor@example.test",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  idempotencyKey: "receipt-abc-0",
};

describe("the retry schedule", () => {
  it("makes one attempt more than it has waits", () => {
    expect(MAX_EMAIL_ATTEMPTS).toBe(EMAIL_RETRY_DELAYS_MS.length + 1);
  });

  it("waits longer each time and finishes within a day", () => {
    const sorted = [...EMAIL_RETRY_DELAYS_MS].sort((a, b) => a - b);
    expect(EMAIL_RETRY_DELAYS_MS).toEqual(sorted);
    const total = EMAIL_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(24 * 60 * 60_000);
  });
});

describe("sendEmail", () => {
  it("posts to Resend with the key, the idempotency key and both bodies", async () => {
    const outcome = await sendEmail(input);

    expect(outcome).toEqual({ kind: "sent", emailId: "em_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
      "Idempotency-Key": "receipt-abc-0",
    });
    expect(JSON.parse(init.body)).toEqual({
      from: EMAIL_FROM,
      to: ["donor@example.test"],
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    });
  });

  it("counts the email as sent even if Resend's answer can't be read", async () => {
    fetchMock.mockImplementation(async () => new Response("not json", { status: 200 }));
    expect(await sendEmail(input)).toEqual({ kind: "sent", emailId: undefined });
  });

  it("does not try to send, and says why, when there is no API key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const outcome = await sendEmail(input);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "failed", retryable: false });
    expect(outcome.kind === "failed" && outcome.error).toContain("RESEND_API_KEY");
  });

  it.each([429, 409, 500, 502, 503])("%i is worth trying again", async (status) => {
    fetchMock.mockImplementation(async () => new Response("busy", { status }));
    expect(await sendEmail(input)).toMatchObject({
      kind: "failed",
      retryable: true,
      statusCode: status,
    });
  });

  it.each([400, 401, 403, 404, 422])("%i is not worth trying again", async (status) => {
    fetchMock.mockImplementation(async () => new Response("no", { status }));
    expect(await sendEmail(input)).toMatchObject({
      kind: "failed",
      retryable: false,
      statusCode: status,
    });
  });

  it("treats a connection failure as worth trying again", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sendEmail(input)).toMatchObject({
      kind: "failed",
      retryable: true,
      error: "fetch failed",
    });
  });

  it("gives up on a request that never answers, and says it timed out", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const pending = sendEmail(input);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await pending).toEqual({
      kind: "failed",
      retryable: true,
      error: "Resend did not answer in time.",
    });
  });

  it("never puts the recipient's address in the error it reports", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          'The address donor@example.test is not valid.\n  "donor@example.test" was refused',
          { status: 422 },
        ),
    );
    const outcome = await sendEmail(input);

    expect(outcome.kind).toBe("failed");
    const error = outcome.kind === "failed" ? outcome.error : "";
    expect(error).not.toContain("donor@example.test");
    expect(error).toContain("[email]");
    expect(error).not.toMatch(/\n/);
  });

  it("keeps a long error short", async () => {
    fetchMock.mockImplementation(async () => new Response("x".repeat(5000), { status: 500 }));
    const outcome = await sendEmail(input);
    expect(outcome.kind === "failed" && outcome.error.length).toBeLessThanOrEqual(300);
  });

  it("does not leak the API key into a failure", async () => {
    fetchMock.mockImplementation(async () => new Response("bad request", { status: 400 }));
    const outcome = await sendEmail(input);
    expect(JSON.stringify(outcome)).not.toContain("re_test_key");
  });
});
