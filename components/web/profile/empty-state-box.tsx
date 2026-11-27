import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconChip } from "./card-heading";

export function EmptyStateBox({
  icon,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary/20 bg-mint px-6 py-10 text-center">
      <IconChip icon={icon} className="size-12 rounded-2xl" />
      <p className="max-w-sm text-pretty text-sm text-primary/70">
        {description}
      </p>
      <Button className="h-10 rounded-full px-5" onClick={onAction}>
        <Plus className="mr-1.5 h-4 w-4" />
        {actionLabel}
      </Button>
    </div>
  );
}
