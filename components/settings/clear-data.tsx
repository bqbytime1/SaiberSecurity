"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Counts {
  events: number;
  incidents: number;
  collected: number;
  simulated: number;
}

/**
 * Removes security data without touching accounts.
 *
 * Two scopes, because the two kinds of data are not equivalent: simulated events are
 * disposable demo material, while collected ones are the only record of what this
 * machine actually did.
 */
export function ClearData() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [confirming, setConfirming] = useState<"simulated" | "all" | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/data", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { data: Counts };
        if (!cancelled) setCounts(body.data);
      } catch {
        // Leaving counts null simply hides the numbers; the controls still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [done]);

  async function clear(scope: "simulated" | "all") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { eventsDeleted: number; incidentsDeleted: number }; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not clear the data");
        return;
      }
      setDone(`Removed ${body.data?.eventsDeleted ?? 0} events and ${body.data?.incidentsDeleted ?? 0} incidents.`);
      setConfirming(null);
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border-critical/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-critical" />
          Clear security data
        </CardTitle>
        <CardDescription>
          Empties the console back to zero. Accounts, sign-in details and these settings are not affected, and this cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {counts && (
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Simulated</dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums">{counts.simulated.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Collected</dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums">{counts.collected.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Incidents</dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums">{counts.incidents.toLocaleString()}</dd>
            </div>
          </dl>
        )}

        {done && (
          <p role="status" className="flex items-start gap-2 rounded-md border border-low/40 bg-low-muted px-3 py-2 text-xs text-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-low" />
            {done}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}

        {confirming === null ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming("simulated")} disabled={pending || counts?.simulated === 0}>
              Remove simulated events
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming("all")} disabled={pending || counts?.events === 0}>
              Remove everything
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-critical/40 bg-critical-muted px-3 py-3">
            <p className="text-xs leading-relaxed text-foreground">
              {confirming === "simulated"
                ? `Permanently delete ${counts?.simulated.toLocaleString() ?? "all"} simulated events? Connections observed on this machine are kept.`
                : `Permanently delete all ${counts?.events.toLocaleString() ?? ""} events and ${counts?.incidents.toLocaleString() ?? ""} incidents, including everything collected from this machine?`}
            </p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={() => void clear(confirming)} disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Yes, delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
