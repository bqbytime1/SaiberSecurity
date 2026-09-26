"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { INCIDENT_STATUS_LABELS, INCIDENT_STATUSES, type IncidentStatus } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DOT: Record<IncidentStatus, string> = {
  OPEN: "bg-critical",
  INVESTIGATING: "bg-info",
  RESOLVED: "bg-low",
  FALSE_POSITIVE: "bg-muted-foreground",
};

export function IncidentStatusSelect({ incidentId, status, compact = false }: { incidentId: string; status: IncidentStatus; compact?: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState<IncidentStatus>(status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: IncidentStatus) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Update failed");
      }
      router.refresh();
    } catch (err) {
      setCurrent(previous);
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <Select value={current} onValueChange={(v) => void change(v as IncidentStatus)} disabled={pending}>
        <SelectTrigger className={cn(compact ? "h-7 w-40 text-xs" : "h-9 w-48")} aria-label="Incident status">
          <span className="flex items-center gap-2">
            {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : <span className={cn("size-1.5 rounded-full", DOT[current])} />}
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {INCIDENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {INCIDENT_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <span className="text-[11px] text-critical" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
