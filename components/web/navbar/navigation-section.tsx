import Link from "next/link";
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import {
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuTrigger,
} from "../../ui/navigation-menu";
import { NavigationItem } from "./navigation-data";

interface NavigationSectionProps {
  triggerLabel: string;
  headerTitle: string;
  headerIcon: LucideIcon | ComponentType<{ className?: string }>;
  items: NavigationItem[];
  columns?: 1 | 2;
  align?: "start" | "center" | "end";
}

export function NavigationSection({
  triggerLabel,
  headerTitle,
  headerIcon: IconComponent,
  items,
  columns = 2,
}: NavigationSectionProps) {
  const widthClass = columns === 2 ? "w-[540px]" : "w-80";
  const gridClass =
    columns === 2 ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2";

  return (
    <NavigationMenuItem>
      <NavigationMenuTrigger>{triggerLabel}</NavigationMenuTrigger>
      <NavigationMenuContent>
        <div className={`${widthClass} p-4`}>
          <div className="flex items-center gap-3 p-3 mb-2 rounded-xl">
            <div className="p-2 rounded-full bg-slate-100 flex items-center justify-center">
              <IconComponent className="w-5 h-5 text-foreground" />
            </div>
            <span className="font-semibold">{headerTitle}</span>
          </div>
          <div className={gridClass}>
            {items.map((item, index) => (
              <Link
                key={index}
                href={item.href}
                className="block p-3 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <div className="font-semibold text-slate-900">{item.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {item.description}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </NavigationMenuContent>
    </NavigationMenuItem>
  );
}
