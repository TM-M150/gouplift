import { PayoutReview } from "@/components/web/admin/payout-review";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <PayoutReview payoutId={id} />;
}
