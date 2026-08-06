import { ChevronRight, FileText, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export function ImpactTab() {
  return (
    <div className="flex flex-col items-center">
      <h1 className="mt-6 text-6xl font-bold">Ksh 0</h1>

      <p className="mt-2 text-center text-muted-foreground text-lg">
        Your total impact from donating, organising and sharing
      </p>

      <Card className="w-full mt-10 grid grid-cols-2 divide-x rounded-2xl p-8">
        <div className="flex items-center gap-4">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div>
            <div className="text-3xl font-bold">0</div>
            <p className="text-muted-foreground">Fundraisers supported</p>
          </div>
        </div>

        <div className="flex items-center gap-4 pl-8">
          <Users className="h-6 w-6 text-muted-foreground" />
          <div>
            <div className="text-3xl font-bold">0</div>
            <p className="text-muted-foreground">People you inspired to help</p>
          </div>
        </div>
      </Card>
      <Link href="#" className="block w-full">
        <Card className="mt-8 rounded-3xl border-0 bg-primary p-8 text-white shadow-none transition-opacity hover:opacity-95">
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Start seeing your impact
              </h2>

              <p className="mt-2 max-w-2xl text-base text-white/80">
                When you donate to and share fundraisers, you can view the total
                impact above.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 text-lg font-semibold">
              Find a fundraiser
              <ChevronRight className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </Link>
    </div>
  );
}
