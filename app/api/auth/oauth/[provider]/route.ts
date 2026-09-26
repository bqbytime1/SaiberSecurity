import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { enforceRateLimit } from "@/lib/api";
import { signValue } from "@/lib/auth";
import { buildAuthorizeUrl, createPkcePair, createState, isOAuthProviderId, isProviderConfigured, redirectUri } from "@/lib/oauth";

export const OAUTH_STATE_COOKIE = "saiber_oauth";
const STATE_TTL_MS = 10 * 60_000;

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Start the authorization-code flow. The state and PKCE verifier are held in a signed,
 * httpOnly cookie that lives only for the duration of the round trip, so the callback
 * can prove the response belongs to a request this browser actually made.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const limited = enforceRateLimit(req, "oauth-start", 20, 5 * 60_000);
  if (limited) return limited;

  const { provider } = await ctx.params;
  const origin = req.nextUrl.origin;

  if (!isOAuthProviderId(provider)) {
    return NextResponse.redirect(new URL("/login?error=unknown_provider", origin));
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.redirect(new URL(`/login?error=provider_unconfigured&provider=${provider}`, origin));
  }

  const state = createState();
  const { verifier, challenge } = createPkcePair();
  const expires = new Date(Date.now() + STATE_TTL_MS);

  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, signValue(`${provider}:${state}:${verifier}`), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  return NextResponse.redirect(buildAuthorizeUrl(provider, { state, challenge, redirectUri: redirectUri(provider, origin) }));
}
