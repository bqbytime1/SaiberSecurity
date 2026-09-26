import { NextResponse } from "next/server";
import { parseBody, withAuth } from "@/lib/api";
import { getAiProviderStatus } from "@/lib/ai";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, user) => NextResponse.json({ data: { settings: await getSettings(user.organizationId), ai: getAiProviderStatus() } }));

export const PATCH = withAuth(async (req, user) => {
  const parsed = await parseBody(req, settingsSchema);
  if ("error" in parsed) return parsed.error;
  const settings = await updateSettings(user.organizationId, parsed.data);
  return NextResponse.json({ data: { settings, ai: getAiProviderStatus() } });
});
