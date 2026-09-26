import { NextResponse } from "next/server";
import { enforceRateLimit, parseBody, parseQuery, withAuth } from "@/lib/api";
import { ingestEvents } from "@/lib/ingest";
import { listEvents } from "@/lib/queries";
import { serializeEvent } from "@/lib/serializers";
import type { RawSecurityEvent } from "@/lib/types";
import { createEventsBodySchema, eventsQuerySchema } from "@/lib/validations";

export const GET = withAuth(async (req) => {
  const parsed = parseQuery(req, eventsQuerySchema);
  if ("error" in parsed) return parsed.error;
  return NextResponse.json(await listEvents(parsed.data));
});

export const POST = withAuth(async (req) => {
  const limited = enforceRateLimit(req, "events-ingest", 60, 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, createEventsBodySchema);
  if ("error" in parsed) return parsed.error;
  const inputs = "events" in parsed.data ? parsed.data.events : [parsed.data];

  const raw: RawSecurityEvent[] = inputs.map((e) => ({
    timestamp: e.timestamp ?? new Date(),
    source: e.source,
    eventType: e.eventType,
    user: e.user ?? null,
    sourceIp: e.sourceIp,
    destinationIp: e.destinationIp ?? null,
    country: e.country ?? null,
    device: e.device ?? null,
    action: e.action,
    status: e.status,
    metadata: e.metadata ?? null,
  }));

  const summary = await ingestEvents(raw);
  return NextResponse.json(
    {
      created: summary.created,
      suspicious: summary.suspicious,
      incidentsCreated: summary.incidentsCreated,
      incidentsUpdated: summary.incidentsUpdated,
      incidentIds: summary.incidentIds,
      events: summary.events.map(serializeEvent),
    },
    { status: 201 },
  );
});
