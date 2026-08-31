// components/ui/TalkToPersonButton.tsx
//
// The header's persistent "Talk to a person" button (TM2_GUIDE.md §1
// non-negotiable: present on every screen, always reachable). Clicking it
// sends the user straight to /checkin with a flag that triggers the
// CRITICAL crisis path immediately — no modal (explicitly banned by the
// guide), just a direct route to real help.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "./Button";
import { t } from "./i18n";
import type { Language } from "@/types/contract";

export function TalkToPersonButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = ((searchParams?.get("lang") === "hi" ? "hi" : "en")) as Language;

  return (
    <Button
      variant="danger"
      className="text-xs px-4"
      onClick={() => router.push(`/checkin?crisis=1&lang=${lang}`)}
    >
      {t("header_talk_to_person", lang)}
    </Button>
  );
}
