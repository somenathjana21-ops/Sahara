// components/ui/Stat.tsx — TM2_GUIDE.md §2
// big number, small label

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-3xl text-ink">{value}</div>
      <div className="text-sm text-ink-soft">{label}</div>
    </div>
  );
}
