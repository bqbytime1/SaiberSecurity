import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError, parseBody } from "@/lib/api";
import { isPasswordResetAvailable } from "@/lib/mailer";
import { GENERIC_RESET_RESPONSE, requestPasswordReset } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "forgot-password", 8, 15 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, forgotPasswordSchema);
  if ("error" in parsed) return parsed.error;

  if (!isPasswordResetAvailable()) {
    return jsonError(503, "Password reset is not configured on this deployment");
  }

  const { email } = parsed.data;

  // A second limit keyed on the address, so one mailbox cannot be flooded from a
  // rotating set of clients. It is enforced silently: telling the caller they hit a
  // per-address limit would confirm the address is worth limiting.
  const perAddress = rateLimit(`forgot-password-address:${email}`, 5, 60 * 60_000);

  try {
    const outcome = perAddress.ok ? await requestPasswordReset(email, req.nextUrl.origin) : {};
    return NextResponse.json({
      // Deliberately identical whether or not the account exists.
      message: GENERIC_RESET_RESPONSE,
      devLink: outcome.devLink,
    });
  } catch (err) {
    console.error("[api] POST /api/auth/forgot-password", err);
    return jsonError(500, "Internal server error");
  }
}
