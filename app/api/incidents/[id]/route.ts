import { NextResponse } from "next/server";
import { jsonError, parseBody, withAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getIncidentWithEvents } from "@/lib/queries";
import { serializeIncident } from "@/lib/serializers";
import { updateIncidentSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_req, user, ctx) => {
  const { id } = await ctx.params;
  if (!id || id.length > 64) return jsonError(400, "Invalid incident id");
  const incident = await getIncidentWithEvents(user.organizationId, id);
  if (!incident) return jsonError(404, "Incident not found");
  return NextResponse.json({ data: incident });
});

export const PATCH = withAuth<Ctx>(async (req, user, ctx) => {
  const { id } = await ctx.params;
  if (!id || id.length > 64) return jsonError(400, "Invalid incident id");
  const parsed = await parseBody(req, updateIncidentSchema);
  if ("error" in parsed) return parsed.error;

  const existing = await prisma.incident.findFirst({ where: { id, organizationId: user.organizationId }, select: { id: true } });
  if (!existing) return jsonError(404, "Incident not found");

  const status = parsed.data.status;
  const closing = status === "RESOLVED" || status === "FALSE_POSITIVE";
  const incident = await prisma.incident.update({
    where: { id },
    data: { ...(status && { status, resolvedAt: closing ? new Date() : null }) },
  });
  return NextResponse.json({ data: serializeIncident(incident) });
});
