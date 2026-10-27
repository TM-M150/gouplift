import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { fetchAuthQuery } from "@/lib/auth-server";

export const metadata: Metadata = {
  title: "Admin · GoUplift",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Staff only. Everyone else gets a 404 rather than a "forbidden", so the
  // page's existence isn't advertised. This is the page-level gate; the
  // Convex functions behind it check the role again on every call.
  const access = await fetchAuthQuery(api.admin.getStaffAccess, {});
  if (!access) notFound();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold">
              GoUplift Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link
                href="/admin/organizations"
                className="hover:text-foreground"
              >
                Organizations
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {access.name} · {access.role.toLowerCase()}
            </span>
            <Link href="/" className="hover:text-foreground">
              Back to site
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
