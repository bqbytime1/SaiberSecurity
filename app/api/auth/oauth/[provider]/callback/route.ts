import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { upsertOAuthUser } from "@/lib/accounts";
import { enforceRateLimit, publicOrigin } from "@/lib/api";
import { createSession, pruneExpiredSessions, readSignedValue } from "@/lib/auth";
import { exchangeCodeForProfile, isOAuthProviderId, isProviderConfigured, redirectUri } from "@/lib/oauth";
import { OAUTH_STATE_COOKIE } from "../route";

type Ctx = { params: Promise<{ provider: string }> };

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function fail(origin: string, reason: string) {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
}

/**
 * Finish the authorization-code flow: verify state, exchange the code, resolve the
 * profile to a user, and start a session. Any failure lands back on /login with a
 * short reason code rather than an error page.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = enforceRateLimit(req, "oauth-callback", 20, 5 * 60_000);
  if (limited) return limited;

  const { provider } = await ctx.params;
  // Must resolve to the same value the authorize request used, or the token exchange
  // is rejected for a redirect_uri mismatch.
  const origin = publicOrigin(req);
  const store = await cookies();

  // The one-shot cookie is cleared regardless of outcome so a state cannot be replayed.
  const signed = store.get(OAUTH_STATE_COOKIE)?.value;
  store.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  if (!isOAuthProviderId(provider) || !isProviderConfigured(provider)) return fail(origin, "unknown_provider");

  const providerError = req.nextUrl.searchParams.get("error");
  if (providerError) return fail(origin, providerError === "access_denied" ? "cancelled" : "provider_error");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return fail(origin, "missing_code");

  const unpacked = readSignedValue(signed);
  if (!unpacked) return fail(origin, "state_missing");

  const sep1 = unpacked.indexOf(":");
  const sep2 = unpacked.indexOf(":", sep1 + 1);
  if (sep1 < 0 || sep2 < 0) return fail(origin, "state_invalid");
  const cookieProvider = unpacked.slice(0, sep1);
  const cookieState = unpacked.slice(sep1 + 1, sep2);
  const verifier = unpacked.slice(sep2 + 1);

  if (cookieProvider !== provider || !equal(cookieState, state)) return fail(origin, "state_mismatch");

  try {
    const profile = await exchangeCodeForProfile(provider, { code, verifier, redirectUri: redirectUri(provider, origin) });
    const result = await upsertOAuthUser(provider, profile);
    if (!result.ok) return fail(origin, "already_registered");

    await createSession(result.value.id);
    void pruneExpiredSessions();
    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch (err) {
    console.error(`[api] GET /api/auth/oauth/${provider}/callback`, err);
    return fail(origin, "exchange_failed");
  }
}
