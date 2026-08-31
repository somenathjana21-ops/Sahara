// app/(public)/page.tsx — TM2_GUIDE.md §3 /
//
// One screen, one message. No photographs of people anywhere — abstract
// dot motif + whitespace only (hard rule, §1).

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dot } from "@/components/ui/Dot";
import { t } from "@/components/ui/i18n";
import type { Language } from "@/types/contract";

function LandingPageInner() {
  const searchParams = useSearchParams();
  const lang = (searchParams.get("lang") === "hi" ? "hi" : "en") as Language;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="relative">
        <Dot color="accent" size={14} className="absolute -top-2 left-8" />
        <Dot color="dot-blue" size={8} className="absolute top-16 right-4" />
        <Dot color="calm" size={10} className="absolute -bottom-4 left-1/3" />

        <h1 className="font-display leading-[1.05] tracking-tight text-[clamp(2.75rem,7vw,4.5rem)]">
          {t("landing_headline", lang)}
        </h1>
        <p className="mt-4 max-w-md text-lg text-ink-soft">
          {t("landing_subhead", lang)}
        </p>

        <p className="mt-6 max-w-md text-base text-ink-soft">
          {t("landing_voluntary", lang)}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/consent?lang=${lang}`}>
            <Button variant="primary">{t("landing_start", lang)}</Button>
          </Link>
          <Link href={`/checkin?crisis=1&lang=${lang}`}>
            <Button variant="danger">{t("landing_talk", lang)}</Button>
          </Link>
        </div>
      </div>

      <div className="mt-20 grid gap-4 sm:grid-cols-3">
        <Card>
          <h2 className="font-semibold">{t("landing_what_does", lang)}</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {t("landing_what_does_body", lang)}
          </p>
        </Card>
        <Card>
          <h2 className="font-semibold">{t("landing_what_doesnt", lang)}</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {t("landing_what_doesnt_body", lang)}
          </p>
        </Card>
        <Card>
          <h2 className="font-semibold">{t("landing_voluntary_title", lang)}</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {t("landing_voluntary_body", lang)}
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageInner />
    </Suspense>
  );
}
