import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import { FoundryGround } from "@/components/layout/FoundryGround";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Proper Bengali shaping (conjuncts, matras) — required to render conversion output correctly. */
const notoSansBengali = Noto_Sans_Bengali({
  variable: "--font-noto-bengali",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Convert2Uni — Legacy Bengali Font Conversion",
  description:
    "Convert legacy Bijoy and SutonnyMJ Bengali text into standards-compliant Unicode, compare documents, and process PDF/DOC/DOCX/TXT files.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansBengali.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <FoundryGround />
        {/* First tab stop on every route — the header nav and, on the landing
            page, a long run of plates sit between the top of the document and
            the content a keyboard visitor actually came for. */}
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AuthProvider>
          <TooltipProvider>
            <SiteHeader />
            <div className="flex flex-1 flex-col">{children}</div>
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
