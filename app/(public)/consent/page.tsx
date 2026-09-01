// app/(public)/consent/page.tsx
//
// When consent is granted, navigates to /checkin with a consentId so the
// checkin page can forward it to the API. For the MVP seed data, we use
// the deterministic consent UUID from schema.sql / seed.ts.

"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConsentNotice } from "@/components/ui/ConsentNotice";

// Seed consent ID matching scripts/seed.ts and schema.sql.
// In production this would come from a POST /api/consent response.
const SEED_CONSENT_ID = "11111111-1111-1111-1111-111111111113";

function ConsentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = searchParams.get("lang") || "en";

  return (
    <ConsentNotice
      onConsent={() =>
        router.push(`/checkin?consentId=${SEED_CONSENT_ID}&lang=${lang}`)
      }
      onDecline={() => router.push(`/?lang=${lang}`)}
    />
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={null}>
      <ConsentPageInner />
    </Suspense>
  );
}
