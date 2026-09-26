import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError, parseBody, withAuth } from "@/lib/api";
import { getLiveSnapshot, getMonitorStatus, pollOnce, startMonitor, stopMonitor } from "@/lib/monitor";
import { monitorActionSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

/**
 * Status of the live collector plus the most recent events it produced.
 *
 * The console polls this, which is what makes the dashboard visibly move without
 * anyone pressing a button.
 */
export const GET = withAuth(async (req, user) => {
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 25)));
  return NextResponse.json({ data: await getLiveSnapshot(user.organizationId, limit) });
});

/** Start, stop, or force an immediate collection cycle. */
export const POST = withAuth(async (req: NextRequest) => {
  const limited = enforceRateLimit(req, "monitor-control", 30, 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, monitorActionSchema);
  if ("error" in parsed) return parsed.error;

  try {
    if (parsed.data.action === "start") return NextResponse.json({ data: startMonitor() });
    if (parsed.data.action === "stop") return NextResponse.json({ data: stopMonitor() });

    const result = await pollOnce();
    return NextResponse.json({ data: getMonitorStatus(), poll: result });
  } catch (err) {
    console.error("[api] POST /api/monitor", err);
    return jsonError(500, "Internal server error");
  }
});
