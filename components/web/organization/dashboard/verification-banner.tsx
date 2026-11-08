import { Clock, TriangleAlert } from "lucide-react";

interface VerificationBannerProps {
  status: "UNVERIFIED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED";
  rejectionReason?: string;
}

// Shown at the top of the organization dashboard until the organization is
// verified. Unverified legacy organizations have nothing to show yet.
export function VerificationBanner({
  status,
  rejectionReason,
}: VerificationBannerProps) {
  if (status === "PENDING_REVIEW") {
    return (
      <div
        role="status"
        className="mx-4 flex items-start gap-3 rounded-xl border bg-muted/50 p-4 lg:mx-6"
      >
        <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Your documents are under review</p>
          <p className="text-sm text-muted-foreground">
            Our team is checking your registration documents. Your organization
            shows as unverified until that&apos;s done.
          </p>
        </div>
      </div>
    );
  }

  if (status === "REJECTED") {
    return (
      <div
        role="alert"
        className="mx-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 lg:mx-6"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            We couldn&apos;t verify your organization
          </p>
          {rejectionReason && (
            <p className="text-sm text-muted-foreground">{rejectionReason}</p>
          )}
        </div>
      </div>
    );
  }

  return null;
}
