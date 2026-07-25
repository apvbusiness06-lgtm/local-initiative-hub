import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

const heading = Fraunces({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["500", "600", "700"],
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Local Initiative",
  description: "Find trusted local businesses across the UK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${heading.variable} ${body.variable}`}>
      <body>
        <ImpersonationBanner />
        {children}
      </body>
    </html>
  );
}
