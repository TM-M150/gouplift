import type { Metadata } from "next";
import { GuestCommentCard } from "@/components/web/fundraiser/guest-comment-card";

// The link in a receipt. It carries a secret in the address, so it stays out of
// search results and out of the Referer header sent to other sites.
export const metadata: Metadata = {
  title: "Leave a comment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function GuestCommentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-24 pt-36">
      <GuestCommentCard token={token} />
    </div>
  );
}
