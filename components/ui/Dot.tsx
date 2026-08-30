// components/ui/Dot.tsx — TM2_GUIDE.md §2
// The decorative accent dot. Purely visual — aria-hidden.

interface DotProps {
  color?: "accent" | "calm" | "dot-blue";
  size?: number;
  className?: string;
}

const colorMap = {
  accent: "bg-accent",
  calm: "bg-calm",
  "dot-blue": "bg-dot-blue",
};

export function Dot({ color = "dot-blue", size = 10, className = "" }: DotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-full ${colorMap[color]} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
