import { Navbar } from "@/components/web/navbar/navbar";
import { Footer } from "@/components/web/footer";

/**
 * The header and footer around every public page. Shared by the public layout
 * and by the 404 page, which sits outside that layout and needs the same frame.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
