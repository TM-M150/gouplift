"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

// Sent to the parent page (public/embed.js listens for it) whenever the
// widget's height changes, so the iframe can grow and shrink to fit instead
// of showing a scrollbar. It only ever carries a number, so it is posted to
// any origin: the embedding page isn't known in advance.
export const EMBED_RESIZE_MESSAGE = "gouplift:embed:resize";

interface EmbedFrameProps {
  dark?: boolean;
  children: React.ReactNode;
}

export function EmbedFrame({ dark = false, children }: EmbedFrameProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    // Opened directly rather than inside someone's page: nothing to tell.
    if (!element || window.parent === window) return;

    let lastHeight = -1;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage(
        { type: EMBED_RESIZE_MESSAGE, height },
        "*",
      );
    };

    // Measure the content, not the document: the document is as tall as the
    // iframe, so it could never report a smaller height.
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn(dark && "dark")}>
      <div className="bg-background p-4 text-foreground">{children}</div>
    </div>
  );
}
