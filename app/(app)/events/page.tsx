import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getEventFilterOptions, listEvents } from "@/lib/queries";
import { eventsQuerySchema } from "@/lib/validations";
import { parseSearchParams, type SearchParams } from "@/lib/search-params";
import { EVENT_TYPE_LABELS, EVENT_TYPES, SEVERITIES } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SimulateButton } from "@/components/simulate-button";
import { EventFilters } from "@/components/events/event-filters";
import { EventsTable } from "@/components/events/events-table";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const query = parseSearchParams(raw, eventsQuerySchema);
  const user = await requireUser();
  const [result, options] = await Promise.all([listEvents(user.organizationId, { ...query, pageSize: 50 }), getEventFilterOptions(user.organizationId)]);
  const dateValue = typeof raw.date === "string" ? raw.date : undefined;

  return (
    <div>
      <PageHeader title="Event Explorer" description="Every ingested security event with its server-side anomaly and risk score. Click a row for full details." actions={<SimulateButton size="sm" />} />

      <Card>
        <EventFilters
          query={{ severity: query.severity, eventType: query.eventType, user: query.user, sourceIp: query.sourceIp, search: query.search, date: dateValue, minRisk: query.minRisk }}
          severities={[...SEVERITIES]}
          eventTypes={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }))}
          users={options.users}
          total={result.total}
        />
        <EventsTable events={result.data} />
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} pageSize={result.pageSize} />
      </Card>
    </div>
  );
}
