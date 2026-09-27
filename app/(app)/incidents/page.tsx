import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listIncidents } from "@/lib/queries";
import { ACTIVE_INCIDENT_FILTER, incidentsQuerySchema } from "@/lib/validations";
import { parseSearchParams, type SearchParams } from "@/lib/search-params";
import { INCIDENT_STATUS_LABELS, INCIDENT_STATUSES, SEVERITIES } from "@/lib/types";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader, EmptyState } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { FilterSelect } from "@/components/filter-select";
import { RiskScore, SeverityBadge } from "@/components/severity-badge";
import { IncidentStatusSelect } from "@/components/incidents/incident-status-select";
import { SimulateButton } from "@/components/simulate-button";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseSearchParams(await searchParams, incidentsQuerySchema);
  const user = await requireUser();
  const result = await listIncidents(user.organizationId, { ...query, pageSize: 25 });
  const now = new Date();
  const filtered = Boolean(query.severity || query.status || query.search);

  return (
    <div>
      <PageHeader title="Incidents" description="Correlated groups of suspicious events, ranked by risk. Update status as you investigate." actions={<SimulateButton size="sm" />} />

      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <SearchInput initial={query.search ?? ""} placeholder="Search title, user or IP…" className="sm:w-72" />
          <div className="flex gap-2">
            <FilterSelect paramKey="severity" value={query.severity} allLabel="All severities" options={SEVERITIES.map((s) => ({ value: s, label: s }))} className="w-40" />
            <FilterSelect
              paramKey="status"
              value={query.status}
              allLabel="All statuses"
              options={[{ value: ACTIVE_INCIDENT_FILTER, label: "Active" }, ...INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] }))]}
              className="w-44"
            />
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{result.total} incident{result.total === 1 ? "" : "s"}</span>
        </div>

        {result.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={filtered ? "No incidents match these filters" : "No incidents detected"}
              description={filtered ? "Try clearing a filter or broadening your search." : "Simulate new events to exercise the detection and correlation engine."}
              action={!filtered ? <SimulateButton size="sm" /> : undefined}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Severity</TableHead>
                <TableHead>Incident</TableHead>
                <TableHead>Risk score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-4">
                    <SeverityBadge severity={i.severity} />
                  </TableCell>
                  <TableCell className="max-w-[420px]">
                    <Link href={`/incidents/${i.id}`} className="font-medium hover:text-primary">
                      {i.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {i.affectedUser && <span className="font-mono">{i.affectedUser}</span>}
                      {i.affectedUser && i.primaryIp && " · "}
                      {i.primaryIp && <span className="font-mono">{i.primaryIp}</span>}
                      {(i.affectedUser || i.primaryIp) && " · "}
                      {i.description}
                    </p>
                  </TableCell>
                  <TableCell>
                    <RiskScore score={i.riskScore} />
                  </TableCell>
                  <TableCell>
                    <IncidentStatusSelect incidentId={i.id} status={i.status} compact />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.eventCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDateTime(i.createdAt)}>
                    {fmtRelative(i.createdAt, now)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/incidents/${i.id}`}>
                        Investigate
                        <ArrowUpRight />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} />
      </Card>
    </div>
  );
}
