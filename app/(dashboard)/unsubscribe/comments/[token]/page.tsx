import type { Metadata } from "next";
import { CommentUnsubscribeCard } from "@/components/web/unsubscribe/comment-unsubscribe-card";

// The link in a comment email. It carries a secret in the address, so it stays
// out of search results and out of the Referer header sent to other sites.
export const metadata: Metadata = {
  title: "Unsubscribe from comment emails",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CommentUnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-24 pt-36">
      <CommentUnsubscribeCard token={token} />
    </div>
  );
}
