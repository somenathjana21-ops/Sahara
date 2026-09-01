// components/ui/Button.tsx — TM2_GUIDE.md §2
// variants: primary (accent), quiet (outline), danger (crisis only)

import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "quiet" | "danger";
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-white",
  quiet: "bg-transparent text-ink border border-line",
  danger: "bg-red-700 text-white",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`min-h-[48px] rounded-btn px-6 text-sm font-semibold
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:opacity-40 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
