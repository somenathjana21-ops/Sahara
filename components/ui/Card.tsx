// components/ui/Card.tsx — TM2_GUIDE.md §2
// white, --r-card radius, hairline border, no shadow by default

import { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface rounded-card border border-line p-6 ${className}`}
      {...props}
    />
  );
}
