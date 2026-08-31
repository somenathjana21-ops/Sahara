import type { Metadata } from "next";
import "./globals.css";
import { Instrument_Serif, Inter } from "next/font/google";

export const metadata: Metadata = {
  title: "Dynamic Distress Monitoring",
  description: "SIH 26094 — check-in monitoring that routes rising risk to a human.",
};

const displayFont = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body className="bg-bg text-ink font-body antialiased">{children}</body>
    </html>
  );
}
