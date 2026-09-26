import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError, parseBody } from "@/lib/api";
import { completePasswordReset } from "@/lib/password-reset";
import { resetPasswordSchema } from "@/lib/validations";

const REASONS: Record<string, string> = {
  invalid: "That reset link is not valid. Request a new one.",
  expired: "That reset link has expired. Request a new one.",
  used: "That reset link has already been used. Request a new one.",
};

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "reset-password", 10, 15 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, resetPasswordSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await completePasswordReset(parsed.data.token, parsed.data.password);
    if (!result.ok) return jsonError(400, REASONS[result.reason] ?? REASONS.invalid);

    // No session is created here on purpose: whoever completes a reset signs in
    // afterwards with the new password, which also confirms it was set as intended.
    return NextResponse.json({ ok: true, email: result.email });
  } catch (err) {
    console.error("[api] POST /api/auth/reset-password", err);
    return jsonError(500, "Internal server error");
  }
}
