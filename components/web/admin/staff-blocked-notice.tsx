import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

interface StaffBlockedNoticeProps {
  /** What is stopping them, in words (from the server). */
  message: string;
  /** Whether the way forward is to confirm their email, so we can point there. */
  canConfirmEmail: boolean;
}

/**
 * What a moderator or admin sees in place of the admin area when their role
 * can't be used yet (their email isn't confirmed, or isn't a company address).
 * It only draws what it is given, so it can be previewed without a backend.
 */
export function StaffBlockedNotice({
  message,
  canConfirmEmail,
}: StaffBlockedNoticeProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <ShieldAlert className="size-10 text-amber-600" aria-hidden />
      <h1 className="text-xl font-semibold">Admin access is on hold</h1>
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {canConfirmEmail && (
          <Link href="/profile" className={buttonVariants()}>
            Go to my profile
          </Link>
        )}
        <Link
          href="/"
          className={buttonVariants({
            variant: canConfirmEmail ? "outline" : "default",
          })}
        >
          Back to GoUplift
        </Link>
      </div>
    </div>
  );
}
