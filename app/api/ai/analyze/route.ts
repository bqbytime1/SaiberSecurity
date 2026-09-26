import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, parseBody, withAuth } from "@/lib/api";
import { reanalyzeIncident } from "@/lib/correlation";
import { serializeIncident } from "@/lib/serializers";
import { analyzeSchema } from "@/lib/validations";

export const POST = withAuth(async (req) => {
  const limited = enforceRateLimit(req, "ai-analyze", 15, 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, analyzeSchema);
  if ("error" in parsed) return parsed.error;

  const incident = await reanalyzeIncident(parsed.data.incidentId);
  if (!incident) return jsonError(404, "Incident not found");
  return NextResponse.json({ data: serializeIncident(incident) });
});
