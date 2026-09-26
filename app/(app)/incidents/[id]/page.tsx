import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Globe, Server, User } from "lucide-react";
import { getIncidentWithEvents } from "@/lib/queries";
import { fmtDateTime, fmtDateTimeSeconds, fmtEventType, fmtRelative } from "@/lib/format";
import type { ScoreFactor } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RiskScore, SeverityBadge, StatusBadge, riskBgClass, riskColorClass } from "@/components/severity-badge";
import { IncidentStatusSelect } from "@/components/incidents/incident-status-select";
import { ReanalyzeButton } from "@/components/incidents/reanalyze-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const incident = await getIncidentWithEvents(id);
  return { title: incident ? incident.title : "Incident" };
}

/** Sum every positive scoring factor across the incident's events so the analyst sees why it was detected. */
function aggregateFactors(events: Array<{ scoreFactors: ScoreFactor[] }>): Array<ScoreFactor & { count: number }> {
  const totals = new Map<string, ScoreFactor & { count: number }>();
  for (const e of events) {
    for (const f of e.scoreFactors) {
      if (f.points <= 0) continue;
      const cur = totals.get(f.label) ?? { label: f.label, points: 0, count: 0, detail: f.detail };
      cur.points += f.points;
      cur.count += 1;
      if (!cur.detail && f.detail) cur.detail = f.detail;
      totals.set(f.label, cur);
    }
  }
  return [...totals.values()].sort((a, b) => b.points - a.points);
}

function describeEvent(e: { eventType: string; action: string; status: string; metadata: Record<string, unknown>; country: string | null; sourceIp: string }): string {
  const m = e.metadata;
  switch (e.eventType) {
    case "failed_login":
    case "credential_attack":
      return `Authentication failed (${String(m.reason ?? "invalid credentials")})`;
    case "successful_login":
      return `Authenticated from ${e.sourceIp}${e.country ? ` (${e.country})` : ""}`;
    case "impossible_travel":
      return `Login from ${e.country ?? "unknown"} ${typeof m.minutesSincePrevious === "number" ? `${m.minutesSincePrevious} min after ${String(m.previousCountry ?? "previous location")}` : ""}`;
    case "data_download":
      return `Downloaded ${typeof m.bytes === "number" ? formatBytes(m.bytes) : "data"}${m.resource ? ` from ${String(m.resource)}` : ""}`;
    case "unusual_api_request":
      return `${String(m.requestCount ?? "Many")} requests to ${String(m.endpoint ?? "API")}`;
    case "port_scan":
      return `Probed ${String(m.portCount ?? "multiple")} ports (${e.status})`;
    case "privilege_escalation":
      return `Granted ${String(m.role ?? "elevated role")}${m.previousRole ? ` (was ${String(m.previousRole)})` : ""}`;
    case "suspicious_process":
      return `${String(m.process ?? "Process")} — ${String(m.commandLine ?? e.action).slice(0, 90)}`;
    case "malware_detected":
      return `${String(m.signature ?? "Malware")} in ${String(m.file ?? "file")} (${e.status})`;
    case "unusual_dns":
      return `Resolved ${String(m.domain ?? "domain")}`;
    case "unauthorized_access":
      return `Access to ${String(m.resource ?? "resource")} ${e.status}`;
    case "configuration_change":
      return `${e.action}: ${String(m.setting ?? "")}`;
    default:
      return e.action;
  }
}

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incident = await getIncidentWithEvents(id);
  if (!incident) notFound();

  const now = new Date();
  const factors = aggregateFactors(incident.events);
  const analysis = incident.aiExplanation;
  const countries = [...new Set(incident.events.map((e) => e.country).filter(Boolean))];
  const devices = [...new Set(incident.events.map((e) => e.device).filter(Boolean))];

  return (
    <div>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/incidents">
            <ArrowLeft />
            Incidents
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <StatusBadge status={incident.status} />
            <Badge variant="outline" className="normal-case tracking-normal">
              {fmtEventType(incident.category)}
            </Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{incident.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{incident.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <IncidentStatusSelect incidentId={incident.id} status={incident.status} />
          <p className="text-[11px] text-muted-foreground">Incident ID {incident.id}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Risk score</p>
            <div className="mt-1 flex items-end gap-2">
              <span className={cn("text-3xl font-bold tabular-nums", riskColorClass(incident.riskScore))}>{incident.riskScore}</span>
              <span className="pb-1 text-xs text-muted-foreground">/ 100</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", riskBgClass(incident.riskScore))} style={{ width: `${incident.riskScore}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="size-3" /> Detected
            </p>
            <p className="mt-1 text-sm font-medium">{fmtDateTime(incident.createdAt)}</p>
            <p className="text-xs text-muted-foreground">
              {fmtRelative(incident.createdAt, now)} · activity {fmtDateTime(incident.firstEventAt)} → {fmtDateTime(incident.lastEventAt)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <User className="size-3" /> Affected user
            </p>
            <p className="mt-1 truncate font-mono text-sm font-medium">{incident.affectedUser ?? "—"}</p>
            {devices.length > 0 && <p className="truncate text-xs text-muted-foreground">{devices.join(", ")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Globe className="size-3" /> Source
            </p>
            <p className="mt-1 truncate font-mono text-sm font-medium">{incident.primaryIp ?? "—"}</p>
            {countries.length > 0 && <p className="text-xs text-muted-foreground">{countries.join(", ")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Server className="size-3" /> Related events
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{incident.eventCount}</p>
            <p className="text-xs text-muted-foreground">{[...new Set(incident.events.map((e) => e.source))].join(", ")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>AI Security Analysis</CardTitle>
              <CardDescription>
                {incident.aiProvider === "remote" ? "Generated by the configured AI provider" : "Generated by the deterministic local analysis engine"} · evidence-driven, not a confirmed verdict
              </CardDescription>
            </div>
            <ReanalyzeButton incidentId={incident.id} />
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</h3>
              <p className="mt-1.5 leading-relaxed">{analysis?.summary ?? "Analysis is not available for this incident yet."}</p>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why was this detected?</h3>
              {analysis?.whySuspicious && <p className="mt-1.5 leading-relaxed text-foreground/90">{analysis.whySuspicious}</p>}
              <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                {factors.slice(0, 8).map((f) => (
                  <li key={f.label} className="flex items-start gap-3 px-3 py-2">
                    <span className={cn("w-12 shrink-0 text-right font-mono text-sm font-semibold tabular-nums", f.points >= 25 ? "text-critical" : f.points >= 12 ? "text-high" : "text-medium")}>+{f.points}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{f.label}</span>
                      {f.detail && <span className="block truncate text-xs text-muted-foreground">{f.detail}</span>}
                    </span>
                    {f.count > 1 && <span className="shrink-0 text-[11px] text-muted-foreground">×{f.count}</span>}
                  </li>
                ))}
                <li className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Factor points are summed per event and capped at 100; the incident score is the peak event risk plus a volume adjustment.</span>
                  <span className="ml-4 shrink-0 font-semibold">
                    Total: <span className={cn("tabular-nums", riskColorClass(incident.riskScore))}>{incident.riskScore}/100</span>
                  </span>
                </li>
              </ul>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 leading-relaxed text-foreground/90">
                {(analysis?.evidence ?? []).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>

            <div className="grid gap-6 md:grid-cols-2">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Risk assessment</h3>
                <p className="mt-1.5 leading-relaxed text-foreground/90">{analysis?.riskAssessment ?? "—"}</p>
              </section>
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Potential impact</h3>
                <p className="mt-1.5 leading-relaxed text-foreground/90">{analysis?.potentialImpact ?? "—"}</p>
              </section>
            </div>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended actions</h3>
              <ol className="mt-2 space-y-2">
                {incident.recommendedActions.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary-muted text-[11px] font-semibold text-primary">{i + 1}</span>
                    <span className="leading-relaxed">{a}</span>
                  </li>
                ))}
              </ol>
            </section>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Event timeline</CardTitle>
            <CardDescription>{incident.events.length} correlated events in chronological order</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="relative ml-2 border-l border-border">
              {incident.events.map((e) => (
                <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-panel", riskBgClass(e.riskScore))} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{fmtDateTimeSeconds(e.timestamp)}</span>
                    <RiskScore score={e.riskScore} showBar={false} className="text-xs" />
                  </div>
                  <p className="mt-0.5 text-sm font-medium">{fmtEventType(e.eventType)}</p>
                  <p className="text-xs text-muted-foreground">{describeEvent(e)}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">
                    {e.user ?? "—"} · {e.sourceIp}
                    {e.country ? ` (${e.country})` : ""} · {e.source}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Related events</CardTitle>
          <CardDescription>Every event correlated into this incident, with its individual score</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Timestamp</TableHead>
                <TableHead>Event type</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Source IP</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="pr-5">Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incident.events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap pl-5 font-mono text-xs">{fmtDateTimeSeconds(e.timestamp)}</TableCell>
                  <TableCell className="text-xs">{fmtEventType(e.eventType)}</TableCell>
                  <TableCell className="font-mono text-xs">{e.user ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.sourceIp}</TableCell>
                  <TableCell className="text-xs">{e.country ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{e.action}</TableCell>
                  <TableCell className="text-xs">{e.status}</TableCell>
                  <TableCell>
                    <RiskScore score={e.riskScore} />
                  </TableCell>
                  <TableCell className="pr-5">
                    <SeverityBadge severity={e.severity} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
