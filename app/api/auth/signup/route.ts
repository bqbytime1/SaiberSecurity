import { NextResponse, type NextRequest } from "next/server";
import { createPasswordUser, publicUser } from "@/lib/accounts";
import { enforceRateLimit, jsonError, parseBody } from "@/lib/api";
import { createSession, pruneExpiredSessions } from "@/lib/auth";
import { signupSchema } from "@/lib/validations";

export async function POST(req: NextRequest) {
  // Generous enough to survive a few rejected passwords, tight enough that the
  // "already exists" response cannot be used to enumerate addresses at speed.
  const limited = enforceRateLimit(req, "signup", 10, 15 * 60_000);
  if (limited) return limited;

  const parsed = await parseBody(req, signupSchema);
  if ("error" in parsed) return parsed.error;

  try {
    const result = await createPasswordUser(parsed.data);
    // Registration unavoidably reveals whether an address is taken; the login route
    // stays deliberately generic so the pair does not become an enumeration oracle.
    if (!result.ok) return jsonError(409, result.error);

    await createSession(result.value.id);
    void pruneExpiredSessions();
    return NextResponse.json({ user: publicUser(result.value) }, { status: 201 });
  } catch (err) {
    console.error("[api] POST /api/auth/signup", err);
    return jsonError(500, "Internal server error");
  }
}
