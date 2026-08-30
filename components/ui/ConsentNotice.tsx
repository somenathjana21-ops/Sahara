// components/ui/ConsentNotice.tsx — TM2_GUIDE.md §3 /consent
//
// Three required, unchecked-by-default checkboxes. "No, go back" must be
// the SAME visual weight as "Continue" — the guide is explicit that
// unequal weight here is a dark pattern, not a style choice.

"use client";

import { useState } from "react";
import { Button } from "./Button";

const CHECKS = [
  "I understand what will be recorded",
  "I understand a counsellor may contact me",
  "I understand this is voluntary and does not affect my case",
] as const;

interface ConsentNoticeProps {
  onConsent: () => void;
  onDecline: () => void;
}

export function ConsentNotice({ onConsent, onDecline }: ConsentNoticeProps) {
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false));
  const allChecked = checked.every(Boolean);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-16">
      <h1 className="font-display text-2xl">Before we begin</h1>

      <div className="space-y-3">
        {CHECKS.map((label, i) => (
          <label key={label} className="flex items-start gap-3 text-sm">
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
            <span>{label}</span>
          </label>
        ))}
      </div>

      {/* Equal visual weight — do not make Continue visually dominant. */}
      <div className="flex gap-3">
        <Button variant="quiet" onClick={onDecline} className="flex-1">
          No, go back
        </Button>
        <Button variant="primary" disabled={!allChecked} onClick={onConsent} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}
