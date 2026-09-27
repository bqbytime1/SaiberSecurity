import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword, keyedHash } from "./auth";
import { sendMail, type MailResult } from "./mailer";
import { prisma } from "./prisma";

/**
 * Password reset by emailed one-time link.
 *
 * Only a keyed hash of each token is stored, so a database leak yields nothing usable.
 * Tokens last one hour, work once, and requesting a new one cancels any still
 * outstanding. Completing a reset deletes every session for that account, so anyone
 * who was already signed in with the old password is turned out.
 */

const CHANNEL = "password_reset";
const TOKEN_TTL_MS = 60 * 60_000;

/** Same wording whether or not the address exists, so this cannot confirm accounts. */
export const GENERIC_RESET_RESPONSE = "If that email has an account, a reset link is on its way.";

function resetUrl(token: string, origin: string): string {
  const base = (process.env.APP_URL || origin).replace(/\/+$/, "");
  return `${base}/reset-password?token=${token}`;
}

export interface RequestResetOutcome {
  /** Present only outside production with no mail provider, for local testing. */
  devLink?: string;
}

/**
 * Issue a reset link. Always resolves, and never reveals whether the account exists.
 */
export async function requestPasswordReset(email: string, origin: string): Promise<RequestResetOutcome> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return {};

  // An account with no password signs in another way. Tell that person how to get in
  // rather than sending a reset link that would set a password they never wanted.
  if (!user.passwordHash) {
    const accounts = await prisma.account.findMany({ where: { userId: user.id }, select: { provider: true } });
    const how = accounts.length ? accounts.map((a) => a.provider).join(" or ") : "your phone number";
    const result = await safeSend({
      to: email,
      subject: "Signing in to SAiberSecurity",
      text: `You asked to reset your SAiberSecurity password, but this account does not use one.\n\nSign in with ${how} instead.\n\nIf you did not request this, you can ignore this message.`,
    });
    return result.preview ? { devLink: result.preview } : {};
  }

  const token = randomBytes(32).toString("base64url");

  await prisma.verificationCode.updateMany({
    where: { channel: CHANNEL, target: email, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.verificationCode.create({
    data: {
      channel: CHANNEL,
      target: email,
      codeHash: keyedHash(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  void prisma.verificationCode
    .deleteMany({ where: { channel: CHANNEL, expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } } })
    .catch(() => undefined);

  const link = resetUrl(token, origin);
  const result = await safeSend({
    to: email,
    subject: "Reset your SAiberSecurity password",
    text: `Use this link to choose a new password. It expires in one hour and works once.\n\n${link}\n\nIf you did not ask for this, ignore this message and your password stays as it is.`,
  });

  return result.preview ? { devLink: link } : {};
}

async function safeSend(message: Parameters<typeof sendMail>[0]): Promise<MailResult> {
  try {
    return await sendMail(message);
  } catch (err) {
    // A delivery failure must not tell the caller whether the address exists.
    console.error("[password-reset] mail delivery failed", err);
    return { delivered: false, provider: "none" };
  }
}

export type ResetOutcome = { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" | "used" };

/** Validate a token and set the new password. Consumes the token either way it ends. */
export async function completePasswordReset(token: string, newPassword: string): Promise<ResetOutcome> {
  const hash = keyedHash(token);

  // Scan only live tokens, and compare in constant time so the lookup itself does not
  // leak which prefix matched.
  const candidates = await prisma.verificationCode.findMany({
    where: { channel: CHANNEL, consumedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const wanted = Buffer.from(hash, "hex");
  const row = candidates.find((c) => {
    const actual = Buffer.from(c.codeHash, "hex");
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  });

  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: "expired" };
  }

  const user = await prisma.user.findUnique({ where: { email: row.target } });
  if (!user) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: "invalid" };
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.verificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    // Every existing session is revoked: a reset is how someone recovers an account
    // they may have lost control of.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  return { ok: true, email: row.target };
}
