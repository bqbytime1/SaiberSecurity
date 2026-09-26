import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError, parseBody } from "@/lib/api";
import { isPhoneSignupAvailable, issuePhoneCode, maskPhone, normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { phoneStartSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "phone-start", 5, 15 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, phoneStartSchema);
  if ("error" in parsed) return parsed.error;

  if (!isPhoneSignupAvailable()) return jsonError(503, "Phone sign-up is not configured on this deployment");

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return jsonError(400, "Enter a phone number in international format, for example +1 555 010 0199");

  // A second limit keyed on the number itself, so one number cannot be flooded with
  // texts from a rotating set of client addresses.
  const perNumber = rateLimit(`phone-start-number:${phone}`, 5, 60 * 60_000);
  if (!perNumber.ok) {
    return NextResponse.json(
      { error: "Too many codes requested for that number. Try again later." },
      { status: 429, headers: { "Retry-After": String(perNumber.retryAfterSec) } },
    );
  }

  try {
    const delivery = await issuePhoneCode(phone, parsed.data.name ?? null);
    return NextResponse.json({
      sent: true,
      to: maskPhone(phone),
      provider: delivery.provider,
      // Present only outside production when no SMS provider is configured, so the
      // flow can be exercised locally without a Twilio account.
      devCode: delivery.devCode,
    });
  } catch (err) {
    console.error("[api] POST /api/auth/phone/start", err);
    return jsonError(502, "Could not send the verification code. Please try again.");
  }
}
