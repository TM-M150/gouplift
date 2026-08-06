import Link from "next/link";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../ui/accordion";
import { NavigationItem } from "./navigation-data";

interface MobileNavigationSectionProps {
  value: string;
  triggerLabel: string;
  items: NavigationItem[];
  onNavigate: () => void;
}

export function MobileNavigationSection({
  value,
  triggerLabel,
  items,
  onNavigate,
}: MobileNavigationSectionProps) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-base font-semibold hover:no-underline">
        {triggerLabel}
      </AccordionTrigger>
      <AccordionContent className="no-underline">
        <div className="flex flex-col gap-1 pb-2">
          {items.map((item, index) => (
            <Link
              key={index}
              href={item.href}
              onClick={onNavigate}
              className="block rounded-xl p-3"
            >
              <div className="font-semibold">{item.title}</div>
              <div className="text-xs mt-0.5">{item.description}</div>
            </Link>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
