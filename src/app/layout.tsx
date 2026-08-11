import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "AMX — the certification layer for enterprise agents",
  description:
    "Catalog, certify, and publish AI agents — with every agent's dependence on governed data products explicit, versioned, and enforced.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-surface text-brand-ink antialiased">{children}</body>
    </html>
  );
}
