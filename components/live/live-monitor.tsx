"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RiskScore, SeverityBadge } from "@/components/severity-badge";
import { fmtDateTimeSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MonitorStatus {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  host: string | null;
  intervalMs: number;
  lastPollAt: string | null;
  nextPollAt: string | null;
  lastDurationMs: number | null;
  polls: number;
  eventsCollected: number;
  connectionsSeen: number;
  externalConnections: number;
  trackedConnections: number;
  lastError: string | null;
}

interface LiveEvent {
  id: string;
  timestamp: string;
  destinationIp: string | null;
  sourceIp: string;
  riskScore: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  device: string | null;
  metadata: Record<string, unknown> | null;
}

interface Payload {
  status: MonitorStatus;
  totals: { collected: number; lastHour: number };
  recent: LiveEvent[];
}

const POLL_MS = 3000;

function secondsSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
}

export function LiveMonitor({ initial }: { initial: Payload | null }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Null until the component has mounted. Seeding this with Date.now() during render
  // makes the server and the browser produce different text for "last sample", which
  // React reports as a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);
  // Ids seen in the previous response, so genuinely new rows can be highlighted.
  const previousIds = useRef<Set<string>>(new Set(initial?.recent.map((e) => e.id) ?? []));
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor?limit=40", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { data: Payload };
      const incoming = body.data.recent.map((e) => e.id);
      const fresh = new Set(incoming.filter((id) => !previousIds.current.has(id)));
      previousIds.current = new Set(incoming);
      if (fresh.size > 0) setFreshIds(fresh);
      setData(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the collector");
    }
  }, []);

  // Poll the collector, and tick a clock so the "last sample" age counts up smoothly
  // between polls rather than jumping.
  useEffect(() => {
    // Deferred rather than set synchronously here: updating state during the effect
    // itself triggers a cascading render, and a few milliseconds of "—" costs nothing.
    const startClock = setTimeout(() => setNow(Date.now()), 0);
    const dataTimer = setInterval(() => void load(), POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    void load();
    return () => {
      clearTimeout(startClock);
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
  }, [load]);

  useEffect(() => {
    if (freshIds.size === 0) return;
    const t = setTimeout(() => setFreshIds(new Set()), 1800);
    return () => clearTimeout(t);
  }, [freshIds]);

  async function control(action: "start" | "stop" | "poll") {
    setBusy(true);
    try {
      await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const status = data?.status;
  const age = now === null ? null : secondsSince(status?.lastPollAt ?? null, now);
  const live = Boolean(status?.running);

  return (
    <div className="space-y-4">
      <Card className={cn(live && "border-primary/40")}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />}
                <span className={cn("relative inline-flex size-2.5 rounded-full", live ? "bg-primary" : "bg-muted-foreground")} />
              </span>
              {live ? "Live — collecting now" : "Collector stopped"}
            </CardTitle>
            <CardDescription>
              {status?.host ? (
                <>
                  Reading the connection table and DNS cache of <span className="font-mono text-foreground">{status.host}</span> every{" "}
                  {Math.round((status.intervalMs ?? 0) / 1000)}s — the machine this app is running on, which on a hosted
                  deployment is the server rather than the computer you are reading this from.
                </>
              ) : (
                "Waiting for the first sample…"
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void control("poll")} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Sample now
            </Button>
            <Button size="sm" variant={live ? "ghost" : "default"} onClick={() => void control(live ? "stop" : "start")} disabled={busy}>
              {live ? <Pause /> : <Play />}
              {live ? "Pause" : "Start"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Last sample" value={age === null ? "—" : `${age}s ago`} tone={age !== null && age < 30 ? "text-primary" : undefined} />
            <Stat label="Samples taken" value={String(status?.polls ?? 0)} />
            <Stat label="Open connections" value={String(status?.connectionsSeen ?? 0)} />
            <Stat label="Leaving this machine" value={String(status?.externalConnections ?? 0)} />
            <Stat label="Events collected" value={String(data?.totals.collected ?? 0)} />
            <Stat label="Last hour" value={String(data?.totals.lastHour ?? 0)} />
          </dl>
          {status?.lastError && <p className="mt-3 rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">Collector error: {status.lastError}</p>}
          {error && <p className="mt-3 text-xs text-muted-foreground">Console could not reach the collector: {error}</p>}
          {status && !status.enabled && (
            <p className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              Collection is disabled by configuration. Set <span className="font-mono">HOST_MONITOR_ENABLED=true</span> to enable it.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Observed connections</CardTitle>
          <CardDescription>Newest first, updating every {POLL_MS / 1000} seconds. Each row is a real outbound connection the monitored host opened — select one for a full report.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {!data || data.recent.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No connections collected yet. The first sample lands within {Math.round((status?.intervalMs ?? 15000) / 1000)} seconds of the collector starting.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Time</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Resolved host</TableHead>
                  <TableHead className="text-right">Port</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="pr-6">Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((e) => {
                  const meta = (e.metadata ?? {}) as { process?: string; remotePort?: number; resolvedHost?: string };
                  const open = () => router.push(`/live/${e.id}`);
                  return (
                    // The row is clickable, and the first cell carries a real link so the
                    // detail page is reachable by keyboard and openable in a new tab.
                    <TableRow
                      key={e.id}
                      className={cn("cursor-pointer transition-colors", freshIds.has(e.id) && "bg-primary-muted/40")}
                      onClick={open}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          open();
                        }
                      }}
                      aria-label={`Connection detail for ${meta.process || "unknown"} to ${e.destinationIp ?? "unknown"}`}
                    >
                      <TableCell className="whitespace-nowrap pl-6 font-mono text-xs text-muted-foreground">
                        <Link href={`/live/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="hover:text-foreground">
                          {fmtDateTimeSeconds(e.timestamp)}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{meta.process || "unknown"}</TableCell>
                      <TableCell className="font-mono text-xs">{e.destinationIp}</TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{meta.resolvedHost || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{meta.remotePort ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <RiskScore score={e.riskScore} />
                      </TableCell>
                      <TableCell className="pr-6">
                        <SeverityBadge severity={e.severity} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 font-mono text-lg tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
