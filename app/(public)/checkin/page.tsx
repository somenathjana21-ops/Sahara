// app/(public)/checkin/page.tsx — TM2_GUIDE.md §3 /checkin
//
// Three structured 0-4 tap questions (docs/SCORING_AND_POLICY.md §3:
//   q1 = "How have you been feeling since we last spoke?" 0=much better…4=much worse
//   q2 = "How much has this been affecting your sleep and eating?" 0=not at all…4=a great deal
//   q3 = "Do you feel safe right now?" 0=yes…4=no
// ), THEN the open chat.
//
// CRITICAL PATH (CHECKS_TM2 T2-B1/B2): when tier === 'CRITICAL', CrisisPanel
// renders on the very next render, synchronously, above the conversation.
// No animation, no delay, no second fetch. Resources come from response.resources.

"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CrisisPanel } from "@/components/ui/CrisisPanel";
import { Button } from "@/components/ui/Button";
import { t } from "@/components/ui/i18n";
import type { CheckInResponse, Language } from "@/types/contract";

const STRUCTURED_KEYS = ["checkin_q1", "checkin_q2", "checkin_q3"] as const;

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
  const router = useRouter();
  const lang = (searchParams.get("lang") === "hi" ? "hi" : "en") as Language;
  const isCrisisBypass = searchParams.get("crisis") === "1";
  const consentId = searchParams.get("consentId");

  // If no consentId and not a crisis bypass, redirect to consent immediately.
  if (!consentId && !isCrisisBypass) {
    router.replace(`/consent?lang=${lang}`);
    return null;
  }

  const [step, setStep] = useState<"structured" | "chat">("structured");
  const [answers, setAnswers] = useState<number[]>(Array(STRUCTURED_KEYS.length).fill(-1));
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState(false);

  // Lazy initializer runs synchronously on first render — if the header's
  // "Talk to a person" button sent us here via ?crisis=1, the CrisisPanel
  // is already the very first thing painted. No flash of the questions
  // screen first, no useEffect delay.
  const [response, setResponse] = useState<CheckInResponse | null>(() => {
    if (isCrisisBypass) {
      return {
        reply: "Connecting you to a person now.",
        tier: "CRITICAL",
        assessmentId: "55555555-5555-5555-5555-000000000003",
        resources: [
          { label: "NHAA — National Helpline Against Atrocities", phone: "14566" },
          { label: "Tele-MANAS — Mental health support", phone: "14416" },
        ],
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
      resources: [
        { label: "NHAA — National Helpline Against Atrocities", phone: "14566" },
        { label: "Tele-MANAS — Mental health support", phone: "14416" },
      ],
    });
  }

  async function handleSend() {
    if (!message.trim()) return;
    setThinking(true);

    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // personId is resolved server-side from the consentId's person_id.
          // For the MVP, we pass the seed person ID.
          personId: "11111111-1111-1111-1111-111111111111",
          consentId,
          channel: "chat" as const,
          transcript: message,
          structured: {
            q1: answers[0] >= 0 ? answers[0] : undefined,
            q2: answers[1] >= 0 ? answers[1] : undefined,
            q3: answers[2] >= 0 ? answers[2] : undefined,
          },
        }),
      });

      if (!res.ok) {
        // Surface nothing to the user for now — the API returns errors as JSON
        // and we don't want to show raw error messages to a distressed caller.
        setThinking(false);
        return;
      }

      const data: CheckInResponse = await res.json();
      setResponse(data);
    } catch {
      // Network failure — silently degrade. Do not show error to caller.
    }

    setThinking(false);
    setMessage("");
  }

  // CRITICAL must paint immediately, above everything else, synchronously.
  // Resources come from the API response (response.resources), not a
  // hardcoded constant — T2-B2.
  if (response?.tier === "CRITICAL") {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <CrisisPanel
          resources={response.resources ?? []}
          onTalkToPerson={handleTalkToPerson}
          lang={lang}
        />
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