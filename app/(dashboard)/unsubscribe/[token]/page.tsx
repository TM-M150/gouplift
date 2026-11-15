import type { Metadata } from "next";
import { UnsubscribeCard } from "@/components/web/unsubscribe/unsubscribe-card";

// The link in an update email. It carries a secret in the address, so it stays
// out of search results and out of the Referer header sent to other sites.
export const metadata: Metadata = {
  title: "Unsubscribe from fundraiser updates",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-24 pt-36">
      <UnsubscribeCard token={token} />
    </div>
  );
}
