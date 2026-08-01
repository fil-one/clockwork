import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

import { WebVitals } from "@/src/features/performance/web-vitals";

export const metadata: Metadata = {
  title: { default: "Fil One Commerce", template: "%s · Fil One Commerce" },
  description:
    "Agreements, services, billing, and partner commerce in one dependable chain.",
  applicationName: "Fil One Commerce",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {children}
        <WebVitals />
      </body>
    </html>
  );
}
