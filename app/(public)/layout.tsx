// app/(public)/layout.tsx — TM2_GUIDE.md §1 non-negotiables
//
// Header with wordmark + LangToggle, and a "Talk to a person" button
// that is present on EVERY screen, in the same position, reachable
// without scrolling, always (CHECKS_TM2 T2-B4).

"use client";

import { Suspense } from "react";
import "../globals.css";
import { Instrument_Serif, Inter } from "next/font/google";
import { useSearchParams } from "next/navigation";
import { LangToggle } from "@/components/ui/LangToggle";
import { TalkToPersonButton } from "@/components/ui/TalkToPersonButton";
import { t } from "@/components/ui/i18n";
import type { Language } from "@/types/contract";

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

function HeaderContent() {
  const searchParams = useSearchParams();
  const lang = (searchParams.get("lang") === "hi" ? "hi" : "en") as Language;

  return (
    <>
      <span className="font-display text-lg">{t("header_title", lang)}</span>
      <div className="flex items-center gap-3">
        <LangToggle />
        <TalkToPersonButton />
      </div>
    </>
  );
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body className="bg-bg text-ink font-body antialiased">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <Suspense fallback={<span className="font-display text-lg">Saathi Check-in</span>}>
            <HeaderContent />
          </Suspense>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
