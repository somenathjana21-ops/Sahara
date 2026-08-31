// components/ui/Field.tsx — TM2_GUIDE.md §2
// label + input, 48px min height

import { InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
}

export function Field({ label, id, ...props }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className="min-h-[48px] w-full rounded-lg border border-line bg-surface px-3 text-sm"
        {...props}
      />
    </div>
  );
}
