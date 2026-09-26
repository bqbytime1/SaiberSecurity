import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, user) => NextResponse.json({ user }));
