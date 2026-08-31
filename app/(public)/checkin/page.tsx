// app/(public)/checkin/page.tsx — TM2_GUIDE.md §3 /checkin
//
// Three structured 0-4 tap questions first (real question text comes from
// docs/SCORING_AND_POLICY.md §3 — not yet pulled into this scaffold,
// placeholders marked below), THEN the open chat.
//
// CRITICAL PATH (CHECKS_TM2 T2-B1/B2): when tier === 'CRITICAL', CrisisPanel
// renders on the very next render, synchronously, above the conversation.
// No animation, no delay, no second fetch.

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrisisPanel } from "@/components/ui/CrisisPanel";
import { Button } from "@/components/ui/Button";
import { t } from "@/components/ui/i18n";
import type { CheckInResponse, Language } from "@/types/contract";

const STRUCTURED_KEYS = ["checkin_q1", "checkin_q2", "checkin_q3"] as const;

const CRISIS_RESOURCES = [
  { label: "NHAA — National Helpline Against Atrocities", phone: "14566" },
  { label: "Tele-MANAS — Mental health support", phone: "14416" },
];

async function mockSubmitCheckin(message: string): Promise<CheckInResponse> {
  // Stand-in until POST /api/checkin exists (TM1). Matches the real
  // CheckInResponse shape from types/contract.ts.
  await new Promise((r) => setTimeout(r, 400));
  return {
    reply: "Thanks for sharing that. Would you like to tell me a bit more?",
    tier: "GREEN",
    assessmentId: "55555555-5555-5555-5555-000000000003",
  };
}

export default function CheckinPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <CheckinPageInner />
    </Suspense>
  );
}

function CheckinPageInner() {
  const searchParams = useSearchParams();
  const lang = (searchParams.get("lang") === "hi" ? "hi" : "en") as Language;

  const [step, setStep] = useState<"structured" | "chat">("structured");
  const [answers, setAnswers] = useState<number[]>(Array(STRUCTURED_KEYS.length).fill(-1));
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState(false);

  // Lazy initializer runs synchronously on first render — if the header's
  // "Talk to a person" button sent us here via ?crisis=1, the CrisisPanel
  // is already the very first thing painted. No flash of the questions
  // screen first, no useEffect delay.
  const [response, setResponse] = useState<CheckInResponse | null>(() => {
    if (searchParams.get("crisis") === "1") {
      return {
        reply: "Connecting you to a person now.",
        tier: "CRITICAL",
        assessmentId: "55555555-5555-5555-5555-000000000003",
      };
    }
    return null;
  });

  function handleTalkToPerson() {
    // Hard bypass — must not go through the LLM or scoring path.
    setResponse({
      reply: "Connecting you to a person now.",
      tier: "CRITICAL",
      assessmentId: "55555555-5555-5555-5555-000000000003",
    });
  }

  async function handleSend() {
    if (!message.trim()) return;
    setThinking(true);
    const res = await mockSubmitCheckin(message);
    setResponse(res);
    setThinking(false);
    setMessage("");
  }

  // CRITICAL must paint immediately, above everything else, synchronously.
  if (response?.tier === "CRITICAL") {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <CrisisPanel resources={CRISIS_RESOURCES} onTalkToPerson={handleTalkToPerson} />
      </div>
    );
  }

  if (step === "structured") {
    const allAnswered = answers.every((a) => a >= 0);
    return (
      <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
        {STRUCTURED_KEYS.map((key, qi) => (
          <div key={key} className="space-y-2">
            <p className="text-sm font-medium">{t(key, lang)}</p>
            <div className="flex gap-2">
              {[0, 1, 2, 3, 4].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    const next = [...answers];
                    next[qi] = val;
                    setAnswers(next);
                  }}
                  aria-pressed={answers[qi] === val}
                  className={`min-h-[48px] min-w-[48px] rounded-btn border border-line text-sm
                    ${answers[qi] === val ? "bg-accent text-white" : "bg-surface"}`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button variant="primary" disabled={!allAnswered} onClick={() => setStep("chat")}>
          {t("checkin_continue", lang)}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
      {response && (
        <div className="rounded-card bg-surface border border-line p-4 text-sm">
          {response.reply}
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("checkin_placeholder", lang)}
        rows={4}
        className="w-full rounded-card border border-line bg-surface p-3 text-sm"
      />

      {/* Plain "…" while waiting — no fake typing animation (guide is explicit: "it is a check-in, not a friend"). */}
      {thinking && <p className="text-sm text-ink-soft">…</p>}

      <Button variant="primary" onClick={handleSend} disabled={thinking || !message.trim()}>
        {t("checkin_send", lang)}
      </Button>
    </div>
  );
}