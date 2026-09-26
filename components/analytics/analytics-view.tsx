import Link from "next/link";
import type { AnalyticsData } from "@/lib/metrics";
import { fmtDateTime, fmtStatus } from "@/lib/format";
import { cn, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { RiskScore, riskColorClass } from "@/components/severity-badge";
import { EventsOverTimeChart, HorizontalBarChart, SimpleBarChart, StackedSeverityIncidentsChart } from "@/components/charts/charts";

function Kpi({ label, value, suffix, hint, tone }: { label: string; value: string | number; suffix?: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", tone)}>
          {value}
          {suffix && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span>}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const openIncidents = data.incidentsByStatus.filter((s) => s.status === "OPEN" || s.status === "INVESTIGATING").reduce((s, x) => s + x.count, 0);

  return (
    <div>
      <PageHeader title="Analytics" description={`Detection performance and threat trends over the last ${data.windowHours} hours · ${fmtDateTime(data.generatedAt)}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Anomaly rate" value={data.anomalyRate} suffix="%" hint={`${formatNumber(data.suspiciousEvents)} of ${formatNumber(data.totalEvents)} events flagged`} tone={data.anomalyRate >= 10 ? "text-high" : undefined} />
        <Kpi label="Average risk score" value={data.averageRiskScore} suffix="/100" hint={`Mean anomaly score ${data.averageAnomalyScore}`} tone={riskColorClass(data.averageRiskScore)} />
        <Kpi label="Events analysed" value={formatNumber(data.totalEvents)} hint={`${data.windowHours}h window`} />
        <Kpi label="Open incidents" value={openIncidents} hint={`${data.incidentsByStatus.find((s) => s.status === "RESOLVED")?.count ?? 0} resolved all-time`} tone={openIncidents > 0 ? "text-high" : undefined} />
        <Kpi label="Mean time to resolve" value={data.meanTimeToResolveMin === null ? "—" : data.meanTimeToResolveMin >= 120 ? Math.round(data.meanTimeToResolveMin / 60) : data.meanTimeToResolveMin} suffix={data.meanTimeToResolveMin === null ? undefined : data.meanTimeToResolveMin >= 120 ? "h" : "min"} hint="Across resolved incidents" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Events per hour</CardTitle>
            <CardDescription>Volume and suspicious share, last {Math.min(data.windowHours, 48)} hours</CardDescription>
          </CardHeader>
          <CardContent>
            <EventsOverTimeChart data={data.eventsPerHour} height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Incidents by severity</CardTitle>
            <CardDescription>Open vs. closed, all time</CardDescription>
          </CardHeader>
          <CardContent>
            <StackedSeverityIncidentsChart data={data.incidentsBySeverity} height={240} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top attack types</CardTitle>
            <CardDescription>Suspicious events by type in window</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topAttackTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">No suspicious events in this window.</p>
            ) : (
              <HorizontalBarChart data={data.topAttackTypes.map((t) => ({ label: t.shortLabel, count: t.count }))} dataKey="count" nameKey="label" name="Suspicious events" height={240} color="#f76b15" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Risk score distribution</CardTitle>
            <CardDescription>All events in window</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart data={data.riskDistribution} xKey="bucket" yKey="count" name="Events" height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Incident status</CardTitle>
            <CardDescription>Workflow state across all incidents</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart data={data.incidentsByStatus.map((s) => ({ status: fmtStatus(s.status), count: s.count }))} xKey="status" yKey="count" name="Incidents" height={240} color="#30a46c" />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Suspicious IPs</CardTitle>
            <CardDescription>External and internal sources producing suspicious events</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {data.suspiciousIps.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-muted-foreground">None in this window.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Source IP</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Avg risk</TableHead>
                    <TableHead className="pr-5 text-right">Peak risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.suspiciousIps.map((ip) => (
                    <TableRow key={ip.sourceIp}>
                      <TableCell className="pl-5">
                        <Link href={`/events?sourceIp=${encodeURIComponent(ip.sourceIp)}`} className="font-mono text-xs hover:text-primary">
                          {ip.sourceIp}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{ip.country ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{ip.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{ip.avgRisk}</TableCell>
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
            <CardTitle>Affected users</CardTitle>
            <CardDescription>Accounts involved in suspicious activity</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {data.affectedUsers.length === 0 ? (
              <p className="px-5 pb-5 text-xs text-muted-foreground">None in this window.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">User</TableHead>
                    <TableHead className="text-right">Suspicious events</TableHead>
                    <TableHead className="text-right">Incidents</TableHead>
                    <TableHead className="pr-5 text-right">Peak risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.affectedUsers.map((u) => (
                    <TableRow key={u.user}>
                      <TableCell className="pl-5">
                        <Link href={`/events?user=${encodeURIComponent(u.user)}`} className="font-mono text-xs hover:text-primary">
                          {u.user}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{u.count}</TableCell>
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
    </div>
  );
}
