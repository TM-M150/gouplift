import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyStateBox({
  icon,
  description,
  actionLabel,
  onAction,
}: {
  icon?: React.ReactNode;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 px-8 py-10 text-center">
      {icon}
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button variant="outline" className="rounded-full" onClick={onAction}>
        <Plus className="mr-1.5 h-4 w-4" />
        {actionLabel}
      </Button>
    </div>
  );
}