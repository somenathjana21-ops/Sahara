// app/(public)/layout.tsx — TM2_GUIDE.md §1 non-negotiables
//
// Header with wordmark + LangToggle, and a "Talk to a person" button
// that is present on EVERY screen, in the same position, reachable
// without scrolling, always (CHECKS_TM2 T2-B4).

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LangToggle } from "@/components/ui/LangToggle";
import { TalkToPersonButton } from "@/components/ui/TalkToPersonButton";
import { t } from "@/components/ui/i18n";
import type { Language } from "@/types/contract";

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
    <>
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <Suspense fallback={<span className="font-display text-lg">Saathi Check-in</span>}>
          <HeaderContent />
        </Suspense>
      </header>
      <main>{children}</main>
    </>
  );
}
