import { NextResponse } from "next/server";
import { parseQuery, withAuth } from "@/lib/api";
import { listIncidents } from "@/lib/queries";
import { incidentsQuerySchema } from "@/lib/validations";

export const GET = withAuth(async (req) => {
  const parsed = parseQuery(req, incidentsQuerySchema);
  if ("error" in parsed) return parsed.error;
  return NextResponse.json(await listIncidents(parsed.data));
});
