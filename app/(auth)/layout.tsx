import Link from "next/link";
import Logo from "@/components/icons/logo";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link href="/" aria-label="Home" className="flex items-center gap-2">
                <Logo size={40} className="w-10 h-10 my-auto" />
            </Link>
            <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "gap-2 text-muted-foreground hover:text-foreground"
            )}
          >
            <ArrowLeft className="size-4" />
            <span>Go to home</span>
          </Link>
        </div>
      </header>
      <main>
        {children}
      </main>
    </div>
  );
}
