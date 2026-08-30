// app/(public)/page.tsx — TM2_GUIDE.md §3 /
//
// One screen, one message. No photographs of people anywhere — abstract
// dot motif + whitespace only (hard rule, §1).

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dot } from "@/components/ui/Dot";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="relative">
        <Dot color="accent" size={14} className="absolute -top-2 left-8" />
        <Dot color="dot-blue" size={8} className="absolute top-16 right-4" />
        <Dot color="calm" size={10} className="absolute -bottom-4 left-1/3" />

        <h1 className="font-display leading-[1.05] tracking-tight text-[clamp(2.75rem,7vw,4.5rem)]">
          You don&apos;t have to carry this alone.
        </h1>
        <p className="mt-4 max-w-md text-lg text-ink-soft">
          A simple, private way to share how you&apos;re doing — in your own words, in your own time.
        </p>

        <p className="mt-6 max-w-md text-base text-ink-soft">
          This is voluntary. It does not affect your case, your relief, or your compensation.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/consent">
            <Button variant="primary">Start a check-in</Button>
          </Link>
          <Link href="/checkin?crisis=1">
            <Button variant="danger">Talk to a person now</Button>
          </Link>
        </div>
      </div>

      <div className="mt-20 grid gap-4 sm:grid-cols-3">
        <Card>
          <h2 className="font-semibold">What this does</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Gives you a quiet, private space to check in on how you&apos;re feeling, whenever you need it.
          </p>
        </Card>
        <Card>
          <h2 className="font-semibold">What this doesn&apos;t do</h2>
          <p className="mt-2 text-sm text-ink-soft">
            It doesn&apos;t replace a counsellor, doesn&apos;t make legal decisions, and never shares anything with police.
          </p>
        </Card>
        <Card>
          <h2 className="font-semibold">It&apos;s voluntary</h2>
          <p className="mt-2 text-sm text-ink-soft">
            You can stop anytime. Taking part — or not — never affects your case or any compensation.
          </p>
        </Card>
      </div>
    </div>
  );
}
