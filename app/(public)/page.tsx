// app/(public)/page.tsx — TM2_GUIDE.md §3 /
//
// One screen, one message. No photographs of people anywhere — abstract
// dot motif + whitespace only (hard rule, §1).
//
// SSR HELPLINES (T2-B3): The helpline numbers 14566 and 14416 MUST be
// present in the static HTML payload so they render before JavaScript loads.
// The static <section> at the bottom is server-rendered and visible even
// with JS disabled.

import { Suspense } from "react";
import { Dot } from "@/components/ui/Dot";
import { LandingClient } from "./LandingClient";

/**
 * Static helpline section — renders in the HTML payload before JS loads.
 * This is a Server Component (no "use client"), so the strings are present
 * in the initial SSR output regardless of hydration.
 */
function StaticHelplines() {
  return (
    <section
      aria-label="Emergency helplines"
      className="mt-12 rounded-card border border-line bg-surface p-6"
    >
      <h2 className="text-sm font-semibold">
        If you need to talk to someone right now
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        These lines are free and available now.
      </p>
      <ul className="mt-3 space-y-2">
        <li className="flex items-baseline justify-between gap-3 text-sm">
          <span>NHAA — National Helpline Against Atrocities</span>
          <a
            href="tel:14566"
            className="font-mono font-semibold underline underline-offset-2"
          >
            14566
          </a>
        </li>
        <li className="flex items-baseline justify-between gap-3 text-sm">
          <span>Tele-MANAS — Mental health support</span>
          <a
            href="tel:14416"
            className="font-mono font-semibold underline underline-offset-2"
          >
            14416
          </a>
        </li>
      </ul>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="relative">
        <Dot color="accent" size={14} className="absolute -top-2 left-8" />
        <Dot color="dot-blue" size={8} className="absolute top-16 right-4" />
        <Dot color="calm" size={10} className="absolute -bottom-4 left-1/3" />

        {/* Client-interactive parts that need useSearchParams for lang */}
        <Suspense fallback={null}>
          <LandingClient />
        </Suspense>
      </div>

      {/* Static helplines — rendered server-side, always in the HTML payload */}
      <StaticHelplines />
    </div>
  );
}
