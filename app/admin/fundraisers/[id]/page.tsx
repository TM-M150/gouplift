import { FundraiserReview } from "@/components/web/admin/fundraiser-review";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <FundraiserReview fundraiserId={id} />;
}
