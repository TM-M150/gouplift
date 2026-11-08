import type { Metadata } from "next";
import { VerificationCenter } from "@/components/web/kyc/verification-center";

export const metadata: Metadata = {
  title: "Verify your identity",
};

export default function VerificationPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-28">
      <VerificationCenter />
    </div>
  );
}
