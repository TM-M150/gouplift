import { PayoutAccountReview } from "@/components/web/admin/payout-account-review";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <PayoutAccountReview payoutAccountId={id} />;
}
