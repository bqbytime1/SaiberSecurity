"use client";

import { useState } from "react";
import Link from "next/link";
import type { EventDTO } from "@/lib/serializers";
import { fmtDateTimeSeconds, fmtEventType } from "@/lib/format";
import { cn, formatBytes } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HOST_AGENT_SOURCE } from "@/lib/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RiskScore, SeverityBadge, riskColorClass } from "@/components/severity-badge";
import { EmptyState } from "@/components/page-header";

function MetaValue({ k, v }: { k: string; v: unknown }) {
  if (k === "bytes" && typeof v === "number") return <>{formatBytes(v)}</>;
  if (Array.isArray(v)) return <>{v.join(", ")}</>;
  return <>{String(v)}</>;
}

export function EventsTable({ events }: { events: EventDTO[] }) {
  const [selected, setSelected] = useState<EventDTO | null>(null);

  if (events.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title="No events match these filters" description="Adjust the filters above or simulate new events." />
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Timestamp</TableHead>
            <TableHead>Event type</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Source IP</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Risk score</TableHead>
            <TableHead className="pr-4">Severity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelected(e)} tabIndex={0} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSelected(e)} role="button" aria-label={`View event ${e.id}`}>
              <TableCell className="whitespace-nowrap pl-4 font-mono text-xs">{fmtDateTimeSeconds(e.timestamp)}</TableCell>
              <TableCell className="text-xs">
                {fmtEventType(e.eventType)}
                {/* Tells real collected traffic apart from the synthetic demo dataset. */}
                {e.source === HOST_AGENT_SOURCE && <span className="ml-1.5 rounded-sm bg-low-muted px-1 text-[10px] font-medium text-low" title="Observed on this host by the live collector">live</span>}
                {e.incidentId && <span className="ml-1.5 rounded-sm bg-primary-muted px-1 text-[10px] font-medium text-primary">incident</span>}
              </TableCell>
              <TableCell className="font-mono text-xs">{e.user ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="font-mono text-xs">{e.sourceIp}</TableCell>
              <TableCell className="text-xs">{e.country ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{e.action}</TableCell>
              <TableCell>
                <RiskScore score={e.riskScore} />
              </TableCell>
              <TableCell className="pr-4">
                <SeverityBadge severity={e.severity} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={selected.severity} />
                  <span className="font-mono text-[11px] text-muted-foreground">{selected.id}</span>
                </div>
                <DialogTitle className="pt-1">{fmtEventType(selected.eventType)}</DialogTitle>
                <DialogDescription>
                  {fmtDateTimeSeconds(selected.timestamp)} · {selected.source}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Field label="Anomaly score">
                  <span className={cn("text-lg font-semibold tabular-nums", riskColorClass(selected.anomalyScore))}>{selected.anomalyScore}</span>
                </Field>
                <Field label="Risk score">
                  <span className={cn("text-lg font-semibold tabular-nums", riskColorClass(selected.riskScore))}>{selected.riskScore}</span>
                </Field>
                <Field label="Status">{selected.status}</Field>
                <Field label="Action">
                  <span className="font-mono text-xs">{selected.action}</span>
                </Field>
                <Field label="User">
                  <span className="font-mono text-xs">{selected.user ?? "—"}</span>
                </Field>
                <Field label="Source IP">
                  <span className="font-mono text-xs">{selected.sourceIp}</span>
                </Field>
                <Field label="Destination">
                  <span className="font-mono text-xs">{selected.destinationIp ?? "—"}</span>
                </Field>
                <Field label="Country">{selected.country ?? "—"}</Field>
                <Field label="Device">
                  <span className="font-mono text-xs">{selected.device ?? "—"}</span>
                </Field>
              </div>

              <section>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scoring factors</h4>
                <ul className="mt-1.5 divide-y divide-border rounded-md border border-border text-sm">
                  {selected.scoreFactors.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 px-3 py-1.5">
                      <span className={cn("w-10 shrink-0 text-right font-mono text-xs font-semibold tabular-nums", f.points < 0 ? "text-low" : f.points >= 25 ? "text-critical" : f.points >= 12 ? "text-high" : "text-muted-foreground")}>
                        {f.points >= 0 ? "+" : ""}
                        {f.points}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{f.label}</span>
                        {f.detail && <span className="block truncate text-[11px] text-muted-foreground">{f.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {Object.keys(selected.metadata).length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Metadata</h4>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-background/60 p-3 font-mono text-xs">
                    {Object.entries(selected.metadata).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-all">
                          <MetaValue k={k} v={v} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {selected.incidentId && (
                <div className="flex justify-end">
                  <Button asChild size="sm">
                    <Link href={`/incidents/${selected.incidentId}`}>Open related incident</Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}
