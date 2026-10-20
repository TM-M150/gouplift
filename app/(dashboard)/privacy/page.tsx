import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { marked, Renderer } from "marked";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Privacy Policy | GoUplift",
  description:
    "Learn how GoUplift collects, uses, stores, and protects your personal data when using our fundraising platform and related services.",
  keywords: [
    "GoUplift",
    "Privacy Policy",
    "data protection",
    "personal data",
    "fundraising platform",
    "Kenya",
    "mobile money",
  ],
  authors: [{ name: "Darius Densel" }],
  creator: "Tommy Maro",
  publisher: "GoUplift",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Privacy Policy | GoUplift",
    description:
      "Official Privacy Policy for the GoUplift fundraising platform. Understand how we handle your personal information.",
    type: "website",
    url: "https://www.gouplift.africa/privacy",
    siteName: "GoUplift",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy | GoUplift",
    description:
      "Official Privacy Policy for the GoUplift fundraising platform.",
  },
  alternates: {
    canonical: "https://www.gouplift.africa/privacy",
  },
};

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-");
}

function getHeadings(markdown: string) {
  const headings: {
    id: string;
    text: string;
    level: number;
  }[] = [];

  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);

    if (!match) continue;

    const level = match[1].length;
    let text = match[2]
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1") // remove links
      .trim();

    // Skip the main page title
    if (
      text.toLowerCase() === "privacy policy" ||
      text.toLowerCase() === "go-uplift ltd privacy policy"
    ) {
      continue;
    }

    headings.push({
      id: slugify(text),
      text,
      level,
    });
  }

  return headings;
}

export default function PrivacyPolicyPage() {
  const filePath = path.join(process.cwd(), "content", "privacy.md");

  const markdown = fs.readFileSync(filePath, "utf8");

  const headings = getHeadings(markdown);

  const renderer = new Renderer();

  renderer.heading = ({ text, depth }) => {
    // Clean the text the same way
    const cleanText = text
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .trim();

    const id = slugify(cleanText);

    if (depth === 1) {
      return `<h1 id="${id}">${cleanText}</h1>`;
    }

    if (depth === 2) {
      return `<h2 id="${id}">${cleanText}</h2>`;
    }

    return `<h3 id="${id}">${cleanText}</h3>`;
  };

  const html = marked.parse(markdown, {
    renderer,
    gfm: true,
    breaks: false,
  });

  return (
    <main className="min-h-screen pt-24 px-4 pb-16 bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-16">
        {/* Header */}
        <header className="mx-auto mb-12 max-w-4xl">
          <div className="mb-5">
            <span className="inline-flex rounded-full border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              Legal
            </span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Privacy Policy
          </h1>

          <p className="mt-4 text-sm text-muted-foreground">
            Last updated: 16 October 2026
          </p>

          <Separator className="mt-8" />
        </header>

        {/* Content + Sidebar */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* Privacy Content */}
          <article
            className="
              min-w-0 max-w-none

              [&_h1]:scroll-mt-28
              [&_h1]:mt-12
              [&_h1]:mb-5
              [&_h1]:text-3xl
              [&_h1]:font-bold
              [&_h1]:tracking-tight

              [&_h2]:scroll-mt-28
              [&_h2]:mt-14
              [&_h2]:mb-5
              [&_h2]:text-2xl
              [&_h2]:font-bold
              [&_h2]:tracking-tight

              [&_h3]:scroll-mt-28
              [&_h3]:mt-10
              [&_h3]:mb-4
              [&_h3]:text-xl
              [&_h3]:font-semibold

              [&_p]:mb-5
              [&_p]:max-w-4xl
              [&_p]:text-base
              [&_p]:leading-8

              [&_ul]:my-6
              [&_ul]:ml-6
              [&_ul]:list-disc
              [&_ul]:space-y-3

              [&_ol]:my-6
              [&_ol]:ml-6
              [&_ol]:list-decimal
              [&_ol]:space-y-3

              [&_li]:pl-2
              [&_li]:leading-7

              [&_a]:font-medium
              [&_a]:underline
              [&_a]:underline-offset-4
            "
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {/* Table of Contents */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">On this page</CardTitle>
                </CardHeader>

                <CardContent className="pt-0">
                  <Separator className="mb-3" />

                  <ScrollArea className="h-[calc(100vh-180px)] pr-4">
                    <nav>
                      <ul className="space-y-1">
                        {headings.map((heading) => (
                          <li key={heading.id}>
                            <a
                              href={`#${heading.id}`}
                              className={`
                                block rounded-md px-3 py-2 text-sm
                                text-muted-foreground
                                transition-colors
                                hover:bg-muted
                                hover:text-foreground
                                ${heading.level === 3 ? "ml-3" : ""}
                              `}
                            >
                              {heading.text}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
