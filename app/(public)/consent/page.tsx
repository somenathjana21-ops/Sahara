// app/(public)/consent/page.tsx

"use client";

import { useRouter } from "next/navigation";
import { ConsentNotice } from "@/components/ui/ConsentNotice";

export default function ConsentPage() {
  const router = useRouter();

  return (
    <ConsentNotice
      onConsent={() => router.push("/checkin")}
      onDecline={() => router.push("/")}
    />
  );
}
