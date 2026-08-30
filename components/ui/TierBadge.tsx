// components/ui/TierBadge.tsx — TM2_GUIDE.md §2
// GREEN / AMBER / RED / CRITICAL. Never color alone — always color + text
// label, for colorblind users and for photocopied screenshots.

type Tier = "GREEN" | "AMBER" | "RED" | "CRITICAL";

const tierStyles: Record<Tier, string> = {
  GREEN: "bg-calm/10 text-calm",
  AMBER: "bg-accent/10 text-accent",
  RED: "bg-alert/10 text-alert",
  CRITICAL: "bg-alert text-white",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-btn px-3 py-1 text-xs font-semibold ${tierStyles[tier]}`}
    >
      <span aria-hidden="true">●</span>
      {tier}
    </span>
  );
}
