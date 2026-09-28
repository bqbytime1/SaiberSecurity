import { NextResponse, type NextRequest } from "next/server";
import { publicUser } from "@/lib/accounts";
import { createSession, pruneExpiredSessions, verifyPassword } from "@/lib/auth";
import { enforceRateLimit, handleRouteError, jsonError, parseBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "login", 10, 5 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, loginSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    // Always run a compare so response timing does not reveal whether the account exists,
    // or whether it exists but has no password because it was created via Google or phone.
    const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid";
    const ok = await verifyPassword(parsed.data.password, hash);
    if (!user || !user.passwordHash || !ok) return jsonError(401, "Invalid email or password");

    await createSession(user.id);
    void pruneExpiredSessions();
    return NextResponse.json({ user: publicUser(user) });
  } catch (err) {
    return handleRouteError(err, "POST /api/auth/login");
  }
}
