import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  icon: LucideIcon;
  value?: string; // undefined = still loading
  hint?: string;
  highlight?: boolean; // amber ring for "needs attention"
  href?: string; // card becomes a link when set
}

export function StatCard({
  title,
  icon: Icon,
  value,
  hint,
  highlight,
  href,
}: StatCardProps) {
  const card = (
    <Card
      className={cn(
        "h-full",
        highlight && "ring-amber-300 dark:ring-amber-500/40",
        href && "transition-shadow hover:shadow-md",
      )}
    >
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <Icon className="size-4 text-muted-foreground" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1">
        {value === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {card}
    </Link>
  ) : (
    card
  );
}
