// app/(public)/LandingClient.tsx — Client island for the landing page
//
// Contains all the interactive parts that need useSearchParams for lang:
// headline text, buttons, and the info cards. The parent page.tsx is a
// Server Component so the static helpline numbers render in the HTML payload.

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { t } from "@/components/ui/i18n";
import type { Language } from "@/types/contract";

export function LandingClient() {
  const searchParams = useSearchParams();
  const lang = (searchParams.get("lang") === "hi" ? "hi" : "en") as Language;

  return (
    <>
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
    </>
  );
}
