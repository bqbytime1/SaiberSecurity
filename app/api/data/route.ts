import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError, parseBody, withAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { clearDataSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

/** Counts behind the "clear everything" control, so the page can say what it will remove. */
export const GET = withAuth(async (_req, user) => {
  const organizationId = user.organizationId;
  const [events, incidents, collected] = await Promise.all([
    prisma.securityEvent.count({ where: { organizationId } }),
    prisma.incident.count({ where: { organizationId } }),
    prisma.securityEvent.count({ where: { organizationId, source: "host-agent" } }),
  ]);
  return NextResponse.json({ data: { events, incidents, collected, simulated: events - collected } });
});

/**
 * Delete security data. Accounts, sessions and settings are untouched.
 *
 * `scope: "simulated"` removes only generated events, leaving anything the host
 * collector actually observed. `scope: "all"` empties both.
 */
export const DELETE = withAuth(async (req: NextRequest, user) => {
  const limited = enforceRateLimit(req, "clear-data", 5, 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, clearDataSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const organizationId = user.organizationId;
    const where = parsed.data.scope === "simulated" ? { organizationId, source: { not: "host-agent" } } : { organizationId };

    // Incidents are detached first: an event row carries the foreign key, and deleting
    // an incident with events still attached would leave them pointing at nothing.
    const events = await prisma.securityEvent.deleteMany({ where });
    const orphaned = await prisma.incident.findMany({ where: { organizationId, events: { none: {} } }, select: { id: true } });
    const incidents = await prisma.incident.deleteMany({ where: { id: { in: orphaned.map((i) => i.id) } } });

    return NextResponse.json({ data: { eventsDeleted: events.count, incidentsDeleted: incidents.count } });
  } catch (err) {
    console.error("[api] DELETE /api/data", err);
    return jsonError(500, "Internal server error");
  }
});
