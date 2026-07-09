import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number; // 0-100
  size?: "sm" | "lg";
}

// Tier thresholds calibrated for the recalibrated scorer (top ~64,
// p95 ~42, p90 ~32). Old `>=80 / >=60` made the badge effectively
// unreachable. New: 50+ = top ~5%, 30+ = top ~12%.
function scoreColor(score: number): string {
  if (score >= 50) return "text-success";
  if (score >= 30) return "text-brand";
  return "text-muted";
}

function scoreLabel(score: number): string {
  if (score >= 50) return "Smart Money";
  if (score >= 30) return "Emerging Trader";
  return "Unranked";
}

export default function ScoreGauge({ score, size = "lg" }: ScoreGaugeProps) {
  const isLg = size === "lg";
  const radius = 15.91;
  const circumference = 2 * Math.PI * radius;
  const dashLength = (score / 100) * circumference;
  const gapLength = circumference - dashLength;

  return (
    <div className={cn("flex shrink-0 flex-col items-center gap-1", isLg ? "w-32" : "w-14")}>
      <div className={cn("relative", isLg ? "h-28 w-28" : "h-14 w-14")}>
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          {/* Background track */}
          <circle
            cx="18" cy="18" r={radius}
            fill="none" stroke="currentColor" strokeWidth="3"
            className="text-elevated"
          />
          {/* Score arc */}
          <circle
            cx="18" cy="18" r={radius}
            fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={`${dashLength} ${gapLength}`}
            strokeLinecap="round"
            className={scoreColor(score)}
          />
        </svg>
        {/* Center score */}
        <span className={cn(
          "absolute inset-0 flex items-center justify-center font-mono font-bold",
          scoreColor(score),
          isLg ? "text-heading" : "text-ui",
        )}>
          {score.toFixed(0)}
        </span>
      </div>
      <span className={cn(
        "font-display font-medium uppercase tracking-header text-center leading-tight",
        scoreColor(score),
        isLg ? "text-label" : "text-micro",
      )}>
        {scoreLabel(score)}
      </span>
    </div>
  );
}
