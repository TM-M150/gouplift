import { Badge } from "@/components/ui/badge";

type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED";

const STATUS_DISPLAY: Record<
  VerificationStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  UNVERIFIED: { label: "Unverified", variant: "outline" },
  PENDING_REVIEW: { label: "Under review", variant: "secondary" },
  VERIFIED: { label: "Verified", variant: "default" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { label, variant } = STATUS_DISPLAY[status];
  return <Badge variant={variant}>{label}</Badge>;
}
