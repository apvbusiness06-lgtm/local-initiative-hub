import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Initiative",
  description: "Find trusted local businesses across the UK.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
