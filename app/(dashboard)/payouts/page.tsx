import type { Metadata } from "next";
import { PayoutsCenter } from "@/components/web/payouts/payouts-center";

export const metadata: Metadata = {
  title: "Payouts",
};

export default function PayoutsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-28">
      <PayoutsCenter />
    </div>
  );
}
