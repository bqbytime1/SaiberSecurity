import "server-only";
import { randomInt, timingSafeEqual } from "node:crypto";
import { keyedHash } from "./auth";
import { prisma } from "./prisma";

/**
 * Phone sign-up by one-time code.
 *
 * Only a keyed hash of each code is stored, codes expire after ten minutes, and every
 * row carries its own attempt counter so a code cannot be brute-forced even if the
 * per-IP rate limit is evaded from multiple addresses.
 *
 * Delivery goes through Twilio when it is configured. With no provider configured the
 * code is written to the server log and returned to the caller so the flow stays
 * demonstrable locally. That fallback is disabled in production.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;

/** Accepts E.164 with or without spacing/punctuation, e.g. "+1 (555) 010-0199". */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("+")) return null;
  const digits = trimmed.slice(1).replace(/[\s().-]/g, "");
  if (!/^\d{7,15}$/.test(digits)) return null;
  return `+${digits}`;
}

/** "+15550100199" -> "+1 555 ••• 0199", for echoing a destination back to the user. */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164;
  return `${e164.slice(0, -6)}•••${e164.slice(-3)}`;
}

export interface SmsDelivery {
  delivered: boolean;
  provider: "twilio" | "none";
  /** Present only outside production when no SMS provider is configured. */
  devCode?: string;
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/** True when phone sign-up can be offered at all: real SMS, or the local dev fallback. */
export function isPhoneSignupAvailable(): boolean {
  return isSmsConfigured() || process.env.NODE_ENV !== "production";
}

async function sendSms(to: string, body: string): Promise<SmsDelivery> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("No SMS provider configured");
    }
    const code = body.match(/\d{6}/)?.[0];
    console.warn(`[phone] No SMS provider configured. Verification code for ${to}: ${code}`);
    return { delivered: false, provider: "none", devCode: code };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Twilio responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return { delivered: true, provider: "twilio" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issue a code for a phone number, superseding any code still outstanding for it.
 * `name` is carried on the row so a sign-up can complete without a second round trip.
 */
export async function issuePhoneCode(phone: string, name: string | null): Promise<SmsDelivery> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await prisma.verificationCode.updateMany({
    where: { target: phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.verificationCode.create({
    data: {
      channel: "phone",
      target: phone,
      codeHash: keyedHash(code),
      name,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  // Opportunistic cleanup so the table does not grow without bound.
  void prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => undefined);

  return sendSms(phone, `Your SaiberSecurity verification code is ${code}. It expires in 10 minutes.`);
}

export type CodeCheck =
  | { ok: true; name: string | null }
  | { ok: false; reason: "not_found" | "expired" | "too_many_attempts" | "mismatch" };

export async function checkPhoneCode(phone: string, code: string): Promise<CodeCheck> {
  const row = await prisma.verificationCode.findFirst({
    where: { target: phone, channel: "phone", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(keyedHash(code), "hex");
  const match = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!match) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: "mismatch" };
  }

  await prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { ok: true, name: row.name };
}
