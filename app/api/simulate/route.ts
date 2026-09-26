import { NextResponse } from "next/server";
import { enforceRateLimit, parseBody, withAuth } from "@/lib/api";
import { ingestEvents } from "@/lib/ingest";
import { prisma } from "@/lib/prisma";
import { serializeIncident } from "@/lib/serializers";
import { createRng, generateLiveBurst, type ScenarioName } from "@/lib/synthetic";
import type { RawSecurityEvent } from "@/lib/types";
import { simulateSchema } from "@/lib/validations";

export const POST = withAuth(async (req, user) => {
  const limited = enforceRateLimit(req, "simulate", 20, 60_000);
  if (limited) return limited;

  const body = req.headers.get("content-length") && req.headers.get("content-length") !== "0" ? await parseBody(req, simulateSchema) : { data: simulateSchema.parse({}) };
  if ("error" in body) return body.error;

  const now = new Date();
  const rng = createRng(now.getTime() % 2_147_483_647);
  const raw: RawSecurityEvent[] = [];
  for (let i = 0; i < body.data.bursts; i++) {
    raw.push(...generateLiveBurst(rng, now, i === 0 ? (body.data.scenario as ScenarioName | undefined) : undefined));
  }

  const summary = await ingestEvents(user.organizationId, raw);
  const incidents = summary.incidentIds.length ? await prisma.incident.findMany({ where: { id: { in: summary.incidentIds }, organizationId: user.organizationId } }) : [];

  return NextResponse.json({
    created: summary.created,
    suspicious: summary.suspicious,
    incidentsCreated: summary.incidentsCreated,
    incidentsUpdated: summary.incidentsUpdated,
    incidents: incidents.map(serializeIncident),
    generatedAt: now.toISOString(),
  });
});
