// components/ui/ConsentNotice.tsx — TM2_GUIDE.md §3 /consent
//
// Three required, unchecked-by-default checkboxes. "No, go back" must be
// the SAME visual weight as "Continue" — the guide is explicit that
// unequal weight here is a dark pattern, not a style choice.

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "./Button";
import { t } from "./i18n";
import type { Language } from "@/types/contract";

const CHECK_KEYS = ["consent_check1", "consent_check2", "consent_check3"] as const;

interface ConsentNoticeProps {
  onConsent: () => void;
  onDecline: () => void;
}

export function ConsentNotice({ onConsent, onDecline }: ConsentNoticeProps) {
  const searchParams = useSearchParams();
  const lang = ((searchParams?.get("lang") === "hi" ? "hi" : "en")) as Language;
  const [checked, setChecked] = useState<boolean[]>(CHECK_KEYS.map(() => false));
  const allChecked = checked.every(Boolean);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-16">
      <h1 className="font-display text-2xl">{t("consent_heading", lang)}</h1>

      <div className="space-y-3">
        {CHECK_KEYS.map((key, i) => (
          <label key={key} className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={checked[i]}
              onChange={(e) => {
                const next = [...checked];
                next[i] = e.target.checked;
                setChecked(next);
              }}
              className="mt-1 h-5 w-5"
            />
            <span>{t(key, lang)}</span>
          </label>
        ))}
      </div>

      {/* Equal visual weight — do not make Continue visually dominant. */}
      <div className="flex gap-3">
        <Button variant="quiet" onClick={onDecline} className="flex-1">
          {t("consent_decline", lang)}
        </Button>
        <Button variant="primary" disabled={!allChecked} onClick={onConsent} className="flex-1">
          {t("consent_continue", lang)}
        </Button>
      </div>
    </div>
  );
}
