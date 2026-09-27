import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { serializeEvent, serializeIncident, type EventDTO, type IncidentDTO } from "./serializers";
import { ACTIVE_INCIDENT_FILTER, type EventsQuery, type IncidentsQuery } from "./validations";

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Every function here takes the organization first. It is not optional and there is no
 * default: a reader that forgets to pass it fails to compile rather than quietly
 * returning another tenant's data.
 */

export async function listEvents(organizationId: string, q: EventsQuery): Promise<Paginated<EventDTO>> {
  const where: Prisma.SecurityEventWhereInput = {
    organizationId,
    ...(q.severity && { severity: q.severity }),
    ...(q.eventType && { eventType: q.eventType }),
    ...(q.user && { user: { contains: q.user } }),
    ...(q.sourceIp && { sourceIp: { contains: q.sourceIp } }),
    ...(q.incidentId && { incidentId: q.incidentId }),
    ...(q.minRisk !== undefined && { riskScore: { gte: q.minRisk } }),
    ...((q.from || q.to) && { timestamp: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
    ...(q.search && {
      OR: [
        { user: { contains: q.search } },
        { sourceIp: { contains: q.search } },
        { destinationIp: { contains: q.search } },
        { action: { contains: q.search } },
        { device: { contains: q.search } },
        { eventType: { contains: q.search } },
        // Searchable so "host-agent" isolates real collected traffic from synthetic data.
        { source: { contains: q.search } },
      ],
    }),
  };

  const [total, rows] = await Promise.all([
    prisma.securityEvent.count({ where }),
    prisma.securityEvent.findMany({
      where,
      orderBy: [{ [q.sort]: q.order }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);

  return { data: rows.map(serializeEvent), page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

export async function listIncidents(organizationId: string, q: IncidentsQuery): Promise<Paginated<IncidentDTO>> {
  const where: Prisma.IncidentWhereInput = {
    organizationId,
    ...(q.severity && { severity: q.severity }),
    ...(q.status && (q.status === ACTIVE_INCIDENT_FILTER ? { status: { in: ["OPEN", "INVESTIGATING"] } } : { status: q.status })),
    ...(q.search && {
      OR: [{ title: { contains: q.search } }, { description: { contains: q.search } }, { affectedUser: { contains: q.search } }, { primaryIp: { contains: q.search } }],
    }),
  };

  const [total, rows] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);

  return { data: rows.map(serializeIncident), page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/** Returns null for an id belonging to another organization, exactly as for one that does not exist. */
export async function getIncidentWithEvents(organizationId: string, id: string): Promise<(IncidentDTO & { events: EventDTO[] }) | null> {
  const incident = await prisma.incident.findFirst({
    where: { id, organizationId },
    include: { events: { orderBy: { timestamp: "asc" } } },
  });
  if (!incident) return null;
  const { events, ...rest } = incident;
  return { ...serializeIncident(rest), events: events.map(serializeEvent) };
}

export async function getEventFilterOptions(organizationId: string): Promise<{ users: string[]; eventTypes: string[] }> {
  const [users, types] = await Promise.all([
    prisma.securityEvent.findMany({ where: { organizationId, user: { not: null } }, distinct: ["user"], select: { user: true }, orderBy: { user: "asc" } }),
    prisma.securityEvent.findMany({ where: { organizationId }, distinct: ["eventType"], select: { eventType: true }, orderBy: { eventType: "asc" } }),
  ]);
  return { users: users.map((u) => u.user!).filter(Boolean), eventTypes: types.map((t) => t.eventType) };
}
