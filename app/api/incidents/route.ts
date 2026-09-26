import { NextResponse } from "next/server";
import { parseQuery, withAuth } from "@/lib/api";
import { listIncidents } from "@/lib/queries";
import { incidentsQuerySchema } from "@/lib/validations";

export const GET = withAuth(async (req, user) => {
  const parsed = parseQuery(req, incidentsQuerySchema);
  if ("error" in parsed) return parsed.error;
  return NextResponse.json(await listIncidents(user.organizationId, parsed.data));
});
