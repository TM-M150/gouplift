import {
  EXAMPLE_EVENT,
  EXPRESS_SAMPLE,
  NODE_VERIFY_SAMPLE,
} from "./verify-sample";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

// What a developer on the receiving end needs: what arrives, how to check it
// is really from GoUplift, and what the delivery guarantees are. It lives on
// the page because organizations have no other way to read it.
export function VerifyGuide() {
  return (
    <details className="group rounded-lg border">
      <summary className="cursor-pointer select-none p-3 text-sm font-medium">
        How webhooks work and how to verify them
      </summary>
      <div className="space-y-4 border-t p-3 text-sm">
        <section className="space-y-2">
          <h4 className="font-medium">What you receive</h4>
          <p className="text-muted-foreground">
            A <code>POST</code> with a JSON body whenever a donation to one of
            your fundraisers completes (<code>donation.completed</code>). The
            Send test button sends a <code>ping</code> so you can check your
            setup. Donor email and phone are never included, and an anonymous
            donor&apos;s name and message are <code>null</code>. We may add
            fields over time, so ignore ones you don&apos;t recognise.
          </p>
          <Code>{EXAMPLE_EVENT}</Code>
          <p className="text-muted-foreground">
            <code>amount</code> and <code>currency</code> are what the donor
            actually paid (KES or USD). <code>source</code> is{" "}
            <code>WEB</code> or <code>EMBED</code>.
          </p>
        </section>

        <section className="space-y-2">
          <h4 className="font-medium">Check it came from GoUplift</h4>
          <p className="text-muted-foreground">
            Every request has a <code>GoUplift-Signature</code> header like{" "}
            <code>t=1761902102,v1=ab12…</code>. <code>v1</code> is the
            HMAC-SHA256, in hex, of <code>{"`${t}.${rawBody}`"}</code>, keyed
            with your signing secret (the whole <code>whsec_…</code> string).
            Always verify against the raw body, and reject requests whose
            timestamp is more than a few minutes old.
          </p>
          <Code>{NODE_VERIFY_SAMPLE}</Code>
          <Code>{EXPRESS_SAMPLE}</Code>
        </section>

        <section className="space-y-2">
          <h4 className="font-medium">Delivery</h4>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Any <code>2xx</code> response means received. Answer quickly (we
              give up after 10 seconds) and do slow work afterwards.
            </li>
            <li>
              Anything else, a timeout, or a failed connection is retried
              after 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours and 24
              hours, then marked failed. You can send a failed delivery again
              from the log.
            </li>
            <li>
              Delivery is <em>at least once</em>: the same event can arrive
              twice. Use the event <code>id</code> (also sent as{" "}
              <code>GoUplift-Event-Id</code>) to ignore repeats.
            </li>
            <li>
              URLs must be <code>https://</code> on a public domain and port
              443. Redirects are not followed.
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}
