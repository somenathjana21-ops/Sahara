// app/(public)/consent/page.tsx

"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConsentNotice } from "@/components/ui/ConsentNotice";

function ConsentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = searchParams.get("lang") || "en";

  return (
    <ConsentNotice
      onConsent={() => router.push(`/checkin?lang=${lang}`)}
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
