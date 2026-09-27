import Link from "next/link";
import { Activity, AlertOctagon, ArrowUpRight, CalendarClock, ShieldAlert, TrendingUp } from "lucide-react";
import type { DashboardMetrics } from "@/lib/metrics";
import type { ThreatLevel } from "@/lib/types";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/page-header";
import { RiskScore, SeverityBadge, StatusBadge, THREAT_COLOR } from "@/components/severity-badge";
import { SimulateButton } from "@/components/simulate-button";
import { LiveStrip } from "@/components/live/live-strip";
import { EventsOverTimeChart, HorizontalBarChart, RiskOverTimeChart, SeverityBarChart } from "@/components/charts/charts";

const THREAT_DESCRIPTION: Record<ThreatLevel, string> = {
  NORMAL: "Activity is within learned baselines. No open high or critical incidents.",
  ELEVATED: "Some deviations from baseline require attention. Review open incidents.",
  HIGH: "Multiple high-risk signals are active. Prioritise investigation of open incidents.",
  CRITICAL: "Critical incidents are open. Immediate investigation and containment recommended.",
};

const THREAT_RING: Record<ThreatLevel, string> = {
  NORMAL: "border-low/40 bg-low-muted",
  ELEVATED: "border-medium/40 bg-medium-muted",
  HIGH: "border-high/40 bg-high-muted",
  CRITICAL: "border-critical/40 bg-critical-muted",
};

/**
 * Each card links to the records it counts, with a filter matching the figure exactly,
 * so the destination never shows a different number than the card that led there.
 */
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "critical" | "high" | "default";
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${formatNumber(value)}. View them.`}
      className="group rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
    >
      <Card className="h-full transition-colors group-hover:border-border-strong">
        <CardContent className="flex items-start justify-between p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", tone === "critical" && value > 0 && "text-critical", tone === "high" && value > 0 && "text-high")}>{formatNumber(value)}</p>
            {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
          </div>
          <span className="rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors group-hover:border-border-strong group-hover:text-primary">
            <Icon className="size-4" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardView({ metrics }: { metrics: DashboardMetrics }) {
  const { totals, threatLevel } = metrics;
  const generated = new Date(metrics.generatedAt);
  // Midnight UTC of the generating day, matching how "events today" is counted.
  const startOfDayUtc = new Date(Date.UTC(generated.getUTCFullYear(), generated.getUTCMonth(), generated.getUTCDate())).toISOString();

  return (
    <div>
      <PageHeader
        title="Security Operations Dashboard"
        description={`Live view of behavioural anomalies across users, devices and infrastructure · updated ${fmtDateTime(generated)}`}
        actions={<SimulateButton />}
      />

      <LiveStrip />

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_3fr]">
        {/* The whole card is the control: clicking it opens whatever drove the level —
            the single incident responsible, the filtered queue, or the events behind it. */}
        <Link
          href={metrics.threatFocus.href}
          aria-label={`Current threat level ${threatLevel}. ${metrics.threatFocus.label}`}
          className="group rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        >
          <Card className={cn("h-full border transition-colors group-hover:border-border-strong", THREAT_RING[threatLevel])}>
            <CardContent className="flex h-full flex-col justify-between p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current threat level</p>
                <p className={cn("mt-2 text-4xl font-bold tracking-tight", THREAT_COLOR[threatLevel])}>{threatLevel}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{THREAT_DESCRIPTION[threatLevel]}</p>
              </div>
              <div>
                <ul className="mt-4 space-y-1 text-xs text-foreground/80">
                  {metrics.threatReasons.map((r) => (
                    <li key={r} className="flex items-start gap-2">
                      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", threatLevel === "NORMAL" ? "bg-low" : threatLevel === "ELEVATED" ? "bg-medium" : threatLevel === "HIGH" ? "bg-high" : "bg-critical")} />
                      {r}
                    </li>
                  ))}
                </ul>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                  {metrics.threatFocus.label}
                  <ArrowUpRight className="size-3.5" />
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Total events" value={totals.totalEvents} hint={`${formatNumber(totals.eventsLast24h)} in last 24h`} icon={Activity} href="/events" />
          <StatCard label="Active incidents" value={totals.activeIncidents} hint="Open or investigating" icon={ShieldAlert} tone="high" href="/incidents?status=ACTIVE" />
          <StatCard label="Critical incidents" value={totals.criticalIncidents} hint="Requires immediate action" icon={AlertOctagon} tone="critical" href="/incidents?severity=CRITICAL&status=ACTIVE" />
          <StatCard label="High-risk events" value={totals.highRiskEvents} hint="Risk score ≥ 55" icon={TrendingUp} tone="high" href="/events?minRisk=55" />
          {/* The card counts from midnight UTC, so the link carries that same boundary. */}
          <StatCard label="Events today" value={totals.eventsToday} hint={`${formatNumber(totals.suspiciousLast24h)} suspicious in 24h`} icon={CalendarClock} href={`/events?from=${startOfDayUtc}`} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Events over time</CardTitle>
            <CardDescription>Hourly event volume for the last 24 hours, with suspicious events highlighted</CardDescription>
          </CardHeader>
          <CardContent>
            <EventsOverTimeChart data={metrics.eventsOverTime} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Risk score over time</CardTitle>
            <CardDescription>Average and peak risk per hour, last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <RiskOverTimeChart data={metrics.eventsOverTime} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Events by severity</CardTitle>
            <CardDescription>All time</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityBarChart data={metrics.eventsBySeverity} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Events by type</CardTitle>
            <CardDescription>Top event types, suspicious share in orange</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.eventsByType.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events recorded yet.</p>
            ) : (
              <HorizontalBarChart data={metrics.eventsByType.slice(0, 7).map((t) => ({ label: t.shortLabel, count: t.count, suspicious: t.suspicious }))} dataKey="count" nameKey="label" name="Total" secondaryKey="suspicious" secondaryName="Suspicious" height={200} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top suspicious IPs</CardTitle>
            <CardDescription>Sources of suspicious activity</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {metrics.topSuspiciousIps.length === 0 ? (
              <p className="px-5 pb-3 text-xs text-muted-foreground">No suspicious sources observed.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Source IP</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="pr-5 text-right">Peak</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.topSuspiciousIps.slice(0, 6).map((ip) => (
                    <TableRow key={ip.sourceIp}>
                      <TableCell className="pl-5">
                        <Link href={`/events?sourceIp=${encodeURIComponent(ip.sourceIp)}`} className="font-mono text-xs hover:text-primary">
                          {ip.sourceIp}
                        </Link>
                        {ip.country && <span className="ml-1.5 text-[10px] text-muted-foreground">{ip.country}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{ip.count}</TableCell>
                      <TableCell className="pr-5 text-right">
                        <RiskScore score={ip.maxRisk} showBar={false} className="text-xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top affected users</CardTitle>
            <CardDescription>Accounts involved in suspicious activity</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {metrics.topAffectedUsers.length === 0 ? (
              <p className="px-5 pb-3 text-xs text-muted-foreground">No affected users.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">User</TableHead>
                    <TableHead className="text-right">Incidents</TableHead>
                    <TableHead className="pr-5 text-right">Peak</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.topAffectedUsers.slice(0, 6).map((u) => (
                    <TableRow key={u.user}>
                      <TableCell className="pl-5">
                        <Link href={`/events?user=${encodeURIComponent(u.user)}`} className="font-mono text-xs hover:text-primary">
                          {u.user}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{u.incidents}</TableCell>
                      <TableCell className="pr-5 text-right">
                        <RiskScore score={u.maxRisk} showBar={false} className="text-xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent incidents</CardTitle>
            <CardDescription>Latest correlated incidents across the environment</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/incidents">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {metrics.recentIncidents.length === 0 ? (
            <div className="px-5 pb-5">
              {/* Real collection is the honest first suggestion; simulating invents
                  threats, which is only useful for demonstrating the console. */}
              <EmptyState
                title="No incidents yet"
                description="Incidents appear when correlated activity crosses the detection threshold. Turn on live monitoring to watch real traffic, or simulate events to see the engine work on invented ones."
                action={<SimulateButton size="sm" />}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Severity</TableHead>
                  <TableHead>Incident</TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Events</TableHead>
                  <TableHead className="pr-5 text-right">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.recentIncidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-5">
                      <SeverityBadge severity={i.severity} />
                    </TableCell>
                    <TableCell>
                      <Link href={`/incidents/${i.id}`} className="font-medium hover:text-primary">
                        {i.title}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{i.affectedUser ?? "—"}</TableCell>
                    <TableCell>
                      <RiskScore score={i.riskScore} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={i.status as never} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.eventCount}</TableCell>
                    <TableCell className="pr-5 text-right text-xs text-muted-foreground" title={fmtDateTime(i.createdAt)}>
                      {fmtRelative(i.createdAt, generated)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
