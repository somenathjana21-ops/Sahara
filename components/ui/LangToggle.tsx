// components/ui/LangToggle.tsx — TM2_GUIDE.md §2
// hi / en, persists in URL param, NOT localStorage (checked by CHECKS_TM2 T2-A7)

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function LangToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lang = searchParams.get("lang") === "hi" ? "hi" : "en";

  function setLang(next: "en" | "hi") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 text-sm" role="group" aria-label="Language">
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`min-h-[48px] rounded-btn px-3 ${lang === "en" ? "bg-ink text-white" : "text-ink-soft"}`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("hi")}
        aria-pressed={lang === "hi"}
        className={`min-h-[48px] rounded-btn px-3 ${lang === "hi" ? "bg-ink text-white" : "text-ink-soft"}`}
      >
        हिं
      </button>
    </div>
  );
}
