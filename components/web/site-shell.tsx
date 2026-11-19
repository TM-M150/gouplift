import { Navbar } from "@/components/web/navbar/navbar";
import { EmailConfirmationBanner } from "@/components/web/email-confirmation-banner";
import { Footer } from "@/components/web/footer";

/**
 * The header and footer around every public page. Shared by the public layout
 * and by the 404 page, which sits outside that layout and needs the same frame.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar>
        <EmailConfirmationBanner />
      </Navbar>
      {/* The header is fixed, so pages leave room for it themselves. What sits
          under it (the email banner) tells us how much more room it needs. */}
      <main className="flex-1 pt-[var(--email-banner-height,0px)]">
        {children}
      </main>
      <Footer />
    </div>
  );
}
