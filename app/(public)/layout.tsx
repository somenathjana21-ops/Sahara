// app/(public)/layout.tsx — TM2_GUIDE.md §1 non-negotiables
//
// Header with wordmark + LangToggle, and a "Talk to a person" button
// that is present on EVERY screen, in the same position, reachable
// without scrolling, always (CHECKS_TM2 T2-B4).

import { Suspense } from "react";
import "../globals.css";
import { Instrument_Serif, Inter } from "next/font/google";
import { LangToggle } from "@/components/ui/LangToggle";
import { TalkToPersonButton } from "@/components/ui/TalkToPersonButton";

// Fonts per TM2_GUIDE.md §1 — display serif for headlines, Inter for body.
const displayFont = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});
const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body className="bg-bg text-ink font-body antialiased">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <span className="font-display text-lg">Saathi Check-in</span>
          <div className="flex items-center gap-3">
                        <Suspense fallback={null}>
              <LangToggle />
            </Suspense>
            <TalkToPersonButton />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
