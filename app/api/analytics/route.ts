import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getAnalytics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, user) => NextResponse.json({ data: await getAnalytics(user.organizationId) }));
