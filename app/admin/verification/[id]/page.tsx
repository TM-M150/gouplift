import { KycReview } from "@/components/web/admin/kyc-review";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <KycReview submissionId={id} />;
}
