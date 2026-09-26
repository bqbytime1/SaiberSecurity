import "server-only";
import { Prisma, type User } from "@prisma/client";
import { hashPassword } from "./auth";
import type { OAuthProfile, OAuthProviderId } from "./oauth";
import { prisma } from "./prisma";

/**
 * Account creation and identity linking, shared by every sign-up route so the rules
 * live in exactly one place.
 */

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;
}

export type CreateResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function createPasswordUser(input: { name: string; email: string; password: string }): Promise<CreateResult<User>> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return { ok: false, error: "An account with that email already exists" };

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        signupMethod: "password",
      },
    });
    return { ok: true, value: user };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "An account with that email already exists" };
    throw err;
  }
}

/**
 * Resolve a federated identity to a user, creating or linking as needed.
 *
 * An identity is linked to a pre-existing account only when the provider asserts the
 * email is verified. Linking on an unverified address would let anyone who can create
 * a provider account claiming someone else's address take over that account.
 */
export async function upsertOAuthUser(provider: OAuthProviderId, profile: OAuthProfile): Promise<CreateResult<User>> {
  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
    include: { user: true },
  });
  if (linked) return { ok: true, value: linked.user };

  if (profile.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      if (!profile.emailVerified) {
        return { ok: false, error: "That email is already registered. Sign in with your password, then link this provider." };
      }
      await prisma.account.create({
        data: { userId: byEmail.id, provider, providerAccountId: profile.providerAccountId, email: profile.email },
      });
      if (!byEmail.emailVerified) {
        await prisma.user.update({ where: { id: byEmail.id }, data: { emailVerified: new Date() } });
      }
      return { ok: true, value: byEmail };
    }
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: profile.email,
        emailVerified: profile.email && profile.emailVerified ? new Date() : null,
        name: profile.name?.trim() || profile.email?.split("@")[0] || "New analyst",
        image: profile.image,
        signupMethod: provider,
        accounts: {
          create: { provider, providerAccountId: profile.providerAccountId, email: profile.email },
        },
      },
    });
    return { ok: true, value: user };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "That account is already registered" };
    throw err;
  }
}

/** Sign-up and sign-in are the same action for phone: a verified number identifies the user. */
export async function upsertPhoneUser(phone: string, name: string | null): Promise<CreateResult<User>> {
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    if (!existing.phoneVerified) {
      await prisma.user.update({ where: { id: existing.id }, data: { phoneVerified: new Date() } });
    }
    return { ok: true, value: existing };
  }

  try {
    const user = await prisma.user.create({
      data: {
        phone,
        phoneVerified: new Date(),
        name: name?.trim() || `Analyst ${phone.slice(-4)}`,
        signupMethod: "phone",
      },
    });
    return { ok: true, value: user };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const retry = await prisma.user.findUnique({ where: { phone } });
      if (retry) return { ok: true, value: retry };
    }
    throw err;
  }
}

/** Shape returned to clients after any successful sign-up or sign-in. */
export function publicUser(user: User) {
  return { id: user.id, email: user.email, phone: user.phone, name: user.name, image: user.image };
}
