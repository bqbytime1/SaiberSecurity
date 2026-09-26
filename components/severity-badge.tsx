import { Badge } from "@/components/ui/badge";
import type { IncidentStatus, Severity, ThreatLevel } from "@/lib/types";
import { fmtStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY_VARIANT: Record<Severity, "critical" | "high" | "medium" | "low"> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? "low"} className={className}>
      {severity}
    </Badge>
  );
}

const STATUS_VARIANT: Record<IncidentStatus, "critical" | "info" | "low" | "secondary"> = {
  OPEN: "critical",
  INVESTIGATING: "info",
  RESOLVED: "low",
  FALSE_POSITIVE: "secondary",
};

export function StatusBadge({ status, className }: { status: IncidentStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "secondary"} className={cn("normal-case tracking-normal", className)}>
      {fmtStatus(status)}
    </Badge>
  );
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--color-critical)",
  HIGH: "var(--color-high)",
  MEDIUM: "var(--color-medium)",
  LOW: "var(--color-low)",
};

export const THREAT_COLOR: Record<ThreatLevel, string> = {
  CRITICAL: "text-critical",
  HIGH: "text-high",
  ELEVATED: "text-medium",
  NORMAL: "text-low",
};

export function riskColorClass(score: number): string {
  if (score >= 80) return "text-critical";
  if (score >= 55) return "text-high";
  if (score >= 30) return "text-medium";
  return "text-low";
}

export function riskBgClass(score: number): string {
  if (score >= 80) return "bg-critical";
  if (score >= 55) return "bg-high";
  if (score >= 30) return "bg-medium";
  return "bg-low";
}

export function RiskScore({ score, className, showBar = true }: { score: number; className?: string; showBar?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {showBar && (
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={cn("block h-full rounded-full", riskBgClass(score))} style={{ width: `${score}%` }} />
        </span>
      )}
      <span className={cn("tabular-nums font-semibold", riskColorClass(score))}>{score}</span>
    </span>
  );
}
