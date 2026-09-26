import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "saiber_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

export interface SessionUser {
  id: string;
  /** Null for accounts created with phone sign-up that never supplied an email. */
  email: string | null;
  phone: string | null;
  name: string;
  image: string | null;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long");
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Cookie value = `${token}.${hmac(token)}`. Only sha256(token) is stored
 * server-side, so a database leak does not yield usable session cookies.
 */
function sign(token: string): string {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Keyed hash for short-lived secrets (one-time codes) that must not be stored in the clear. */
export function keyedHash(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

/**
 * Sign an arbitrary short-lived value (OAuth state, PKCE verifier) so it can ride in a
 * cookie without being tampered with. Returns `${value}.${hmac}`.
 */
export function signValue(value: string): string {
  return `${value}.${sign(value)}`;
}

/** Inverse of {@link signValue}; returns null when the signature does not verify. */
export function readSignedValue(signed: string | undefined): string | null {
  return parseCookie(signed);
}

function parseCookie(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const token = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = sign(token);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  return token;
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, `${token}.${sign(token)}`, cookieOptions(expiresAt));
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = parseCookie(store.get(SESSION_COOKIE)?.value);
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = parseCookie(store.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, phone: true, name: true, image: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

/** Opportunistic cleanup of expired sessions; safe to call from any request. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}
