import { NextResponse } from "next/server";
import { jsonError, withAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { serializeEvent, serializeIncident } from "@/lib/serializers";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_req, _user, ctx) => {
  const { id } = await ctx.params;
  if (!id || id.length > 64) return jsonError(400, "Invalid event id");
  const event = await prisma.securityEvent.findUnique({ where: { id }, include: { incident: true } });
  if (!event) return jsonError(404, "Event not found");
  const { incident, ...rest } = event;
  return NextResponse.json({ data: { ...serializeEvent(rest), incident: incident ? serializeIncident(incident) : null } });
});
