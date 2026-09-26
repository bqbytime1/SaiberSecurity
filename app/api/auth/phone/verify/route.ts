import { NextResponse, type NextRequest } from "next/server";
import { publicUser, upsertPhoneUser } from "@/lib/accounts";
import { enforceRateLimit, jsonError, parseBody } from "@/lib/api";
import { createSession, pruneExpiredSessions } from "@/lib/auth";
import { checkPhoneCode, isPhoneSignupAvailable, normalizePhone } from "@/lib/phone";
import { phoneVerifySchema } from "@/lib/validations";

const REASONS: Record<string, string> = {
  not_found: "That code has expired or was already used. Request a new one.",
  expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many incorrect attempts. Request a new code.",
  mismatch: "That code is not correct.",
};

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "phone-verify", 15, 15 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, phoneVerifySchema);
  if ("error" in parsed) return parsed.error;

  if (!isPhoneSignupAvailable()) return jsonError(503, "Phone sign-up is not configured on this deployment");

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return jsonError(400, "Enter a phone number in international format, for example +1 555 010 0199");

  try {
    const check = await checkPhoneCode(phone, parsed.data.code);
    if (!check.ok) return jsonError(401, REASONS[check.reason] ?? "That code is not correct.");

    const result = await upsertPhoneUser(phone, check.name ?? parsed.data.name ?? null);
    if (!result.ok) return jsonError(409, result.error);

    await createSession(result.value.id);
    void pruneExpiredSessions();
    return NextResponse.json({ user: publicUser(result.value) });
  } catch (err) {
    console.error("[api] POST /api/auth/phone/verify", err);
    return jsonError(500, "Internal server error");
  }
}
