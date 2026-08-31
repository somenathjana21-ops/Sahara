// components/ui/CrisisPanel.tsx — TM2_GUIDE.md §2/§3, SAFETY_SPEC.md
//
// The ONE place --alert red is allowed to appear (CHECKS_TM2 T2-B5 greps
// for stray --alert usage elsewhere and fails the build if found).
//
// SAFETY-CRITICAL (CHECKS_TM2 T2-B1/T2-B2): when a response carries
// tier === 'CRITICAL', this must render on the VERY NEXT render — no
// useEffect fetch, no animation, no waitFor. It renders directly from
// response.resources, nothing fetched afterward.

"use client";

import { useSearchParams } from "next/navigation";
import { t } from "./i18n";
import type { Language } from "@/types/contract";

interface CrisisResource {
  label: string;
  phone: string;
  note?: string;
}

interface CrisisPanelProps {
  resources: CrisisResource[];
  onTalkToPerson: () => void;
}

export function CrisisPanel({ resources, onTalkToPerson }: CrisisPanelProps) {
  const searchParams = useSearchParams();
  const lang = ((searchParams?.get("lang") === "hi" ? "hi" : "en")) as Language;

  return (
    <aside
      role="complementary"
      aria-label="Crisis support resources"
      className="rounded-card border-2 border-alert bg-alert/5 p-5 space-y-3"
    >
      <h2 className="text-base font-semibold text-alert">
        {t("crisis_heading", lang)}
      </h2>
      <p className="text-sm text-ink-soft">
        {t("crisis_subhead", lang)}
      </p>

      <ul className="space-y-2">
        {resources.map((r) => (
          <li key={r.phone} className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{r.label}</span>
            <a href={`tel:${r.phone}`} className="font-mono text-sm font-semibold underline underline-offset-2">
              {r.phone}
            </a>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onTalkToPerson}
        className="w-full min-h-[48px] rounded-btn bg-alert px-4 text-sm font-semibold text-white
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t("crisis_button", lang)}
      </button>
    </aside>
  );
}
