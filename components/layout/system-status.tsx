import type { ThreatLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

const THREAT_DOT: Record<ThreatLevel, string> = {
  NORMAL: "bg-low",
  ELEVATED: "bg-medium",
  HIGH: "bg-high",
  CRITICAL: "bg-critical",
};

const THREAT_TEXT: Record<ThreatLevel, string> = {
  NORMAL: "text-low",
  ELEVATED: "text-medium",
  HIGH: "text-high",
  CRITICAL: "text-critical",
};

export function SystemStatus({ threatLevel, ai }: { threatLevel: ThreatLevel; ai: { configured: boolean; model: string | null } }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Detection engine</span>
        <span className="flex items-center gap-1.5 font-medium text-low">
          <span className="status-dot-live size-1.5 rounded-full bg-low" />
          Online
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Threat level</span>
        <span className={cn("flex items-center gap-1.5 font-semibold", THREAT_TEXT[threatLevel])}>
          <span className={cn("size-1.5 rounded-full", THREAT_DOT[threatLevel])} />
          {threatLevel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">AI analysis</span>
        <span className="font-medium text-foreground" title={ai.configured ? `Remote provider · ${ai.model}` : "Deterministic local engine"}>
          {ai.configured ? "Remote" : "Local engine"}
        </span>
      </div>
    </div>
  );
}
