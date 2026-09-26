import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Cpu, Globe, Network, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getConnectionReport } from "@/lib/connections";
import { fmtDateTime, fmtDateTimeSeconds, fmtRelative } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { RiskScore, SeverityBadge } from "@/components/severity-badge";

export const metadata: Metadata = { title: "Connection detail" };
export const dynamic = "force-dynamic";

function Fact({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 break-all font-mono text-sm" : "mt-0.5 text-sm"}>{value}</dd>
    </div>
  );
}

export default async function ConnectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const report = await getConnectionReport(user.organizationId, id);
  if (!report) notFound();

  const { event, destination, processHistory } = report;
  const now = new Date();
  const dash = <span className="text-muted-foreground">—</span>;

  return (
    <div>
      <Link href="/live" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Live monitoring
      </Link>

      <PageHeader
        title={`${report.process} → ${report.resolvedHost ?? event.destinationIp ?? "unknown"}`}
        description={`Outbound connection observed on ${event.device ?? "this host"} at ${fmtDateTimeSeconds(event.timestamp)} (${fmtRelative(event.timestamp, now)}).`}
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="size-4" />
                Connection
              </CardTitle>
              <CardDescription>Read from the operating system&apos;s connection table. There is no payload, because this is not packet capture.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Fact label="Destination" value={event.destinationIp ?? dash} />
                <Fact label="Remote port" value={report.remotePort ?? dash} />
                <Fact label="Resolved host" value={report.resolvedHost ?? dash} />
                <Fact label="Source" value={event.sourceIp} />
                <Fact label="Local port" value={report.localPort ?? dash} />
                <Fact label="Protocol" value="TCP" />
                <Fact label="State" value={event.status} />
                <Fact label="Direction" value="Outbound" />
                <Fact label="Scope" value={report.isPrivateDestination ? "Private / LAN" : "Public internet"} mono={false} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4" />
                Process
              </CardTitle>
              <CardDescription>The program on this machine that opened the socket.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Fact label="Name" value={report.process} />
                <Fact label="PID" value={report.pid ?? dash} />
                <Fact label="Connections seen" value={processHistory.total} />
                <Fact label="Distinct destinations" value={processHistory.distinctDestinations} />
              </dl>
              {processHistory.topPeers.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Where else this process connects</p>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {processHistory.topPeers.map((p) => (
                      <li key={p.address} className="flex items-baseline justify-between gap-3 rounded-md border border-border px-2.5 py-1.5">
                        <span className="truncate font-mono text-xs">{p.resolvedHost || p.address}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.count}×</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Why this score</CardTitle>
              <CardDescription>
                Every contribution the engine made, summed to {event.anomalyScore} and adjusted to a risk of {event.riskScore}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {event.scoreFactors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No factors were recorded for this event.</p>
              ) : (
                event.scoreFactors.map((f, i) => (
                  <div key={`${f.label}-${i}`} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
                    <span className={`shrink-0 font-mono text-sm ${f.points > 0 ? "text-high" : "text-low"}`}>
                      {f.points > 0 ? "+" : ""}
                      {f.points}
                    </span>
                    <span>
                      <span className="text-sm font-medium">{f.label}</span>
                      {f.detail && <span className="block text-xs text-muted-foreground">{f.detail}</span>}
                    </span>
                  </div>
                ))
              )}
              <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                A plain outbound connection carries a base weight of 1, so ordinary browsing stays quiet. Points are added for the shape of the connection — an unusual port, a
                scripting host reaching out, or a destination no DNS lookup explains.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Risk</p>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="text-3xl font-semibold tabular-nums">{event.riskScore}</span>
                  <SeverityBadge severity={event.severity} />
                </div>
                <div className="mt-2">
                  <RiskScore score={event.riskScore} />
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Port assessment</p>
                <p className="mt-1 text-sm">{report.commonPort ? "Common service port" : "Uncommon port"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {report.commonPort
                    ? "This port carries everyday traffic such as web or mail, so it is unremarkable on its own."
                    : "This port is outside the everyday set, which contributes to the score but is not suspicious by itself."}
                </p>
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Name resolution</p>
                <p className="mt-1 break-all font-mono text-sm">{report.resolvedHost ?? "No matching lookup"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {report.resolvedHost
                    ? "A DNS entry on this machine maps the destination to this name."
                    : "No cached lookup explains this address. That is common for connections reusing an expired cache entry, and normal for content delivery networks."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4" />
                This destination
              </CardTitle>
              <CardDescription>Everything this machine has sent to {event.destinationIp}.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Connections" value={destination.total} />
                <Fact label="Peak risk" value={destination.maxRisk} />
                <Fact label="First seen" value={destination.firstSeen ? fmtRelative(destination.firstSeen, now) : dash} mono={false} />
                <Fact label="Last seen" value={destination.lastSeen ? fmtRelative(destination.lastSeen, now) : dash} mono={false} />
              </dl>
              {destination.ports.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Ports used: <span className="font-mono text-foreground">{destination.ports.join(", ")}</span>
                </p>
              )}
              {destination.processes.length > 1 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Contacted by: <span className="font-mono text-foreground">{destination.processes.map((p) => `${p.name} (${p.count})`).join(", ")}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {report.incident && (
            <Card className="border-high/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="size-4" />
                  Correlated incident
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/incidents/${report.incident.id}`} className="text-sm font-medium text-primary hover:underline">
                  {report.incident.title}
                  <ArrowUpRight className="ml-1 inline size-3.5" />
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{report.incident.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {report.related.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Other connections to this destination</CardTitle>
            <CardDescription>The same remote address, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-6">Time</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead className="text-right">Port</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead className="pr-6">Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.related.map((e) => {
                  const m = e.metadata as { process?: string; remotePort?: number };
                  return (
                    <TableRow key={e.id} className="cursor-pointer">
                      <TableCell className="pl-6">
                        <Link href={`/live/${e.id}`} className="block whitespace-nowrap font-mono text-xs text-muted-foreground hover:text-foreground" title={fmtDateTime(e.timestamp)}>
                          {fmtDateTimeSeconds(e.timestamp)}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.process ?? "unknown"}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{m.remotePort ?? "—"}</TableCell>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
