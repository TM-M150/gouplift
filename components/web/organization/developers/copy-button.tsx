"use client";

import * as React from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (insecure page, browser settings).
      toast.error("Couldn't copy automatically. Select the text and copy it.");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <IconCheck /> : <IconCopy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
