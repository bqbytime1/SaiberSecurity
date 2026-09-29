import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/api";
import { runHealthChecks } from "@/lib/health";
import { listOAuthProviders, redirectUri } from "@/lib/oauth";

/**
 * Whether this deployment is actually able to work, and if not, why.
 *
 * A misconfigured deployment used to present as "Internal server error" on sign-in,
 * which is indistinguishable from a bug and sends you reading application code instead
 * of setting an environment variable. This answers the question directly.
 *
 * Deliberately public and unauthenticated: sign-in is exactly what fails when the
 * configuration is wrong, so a check you must sign in to reach would be useless. That
 * makes what it reports a security question, so it reports only whether each thing is
 * usable and a short description of the fault — never a connection string, never a
 * secret, never a raw driver error, which can carry a host name or credentials.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const checks = await runHealthChecks();
  const ok = checks.every((c) => c.ok);

  // The callback URL each provider needs registered, computed from the origin this
  // request actually arrived on. A mismatch here is the usual reason single sign-on
  // fails, and the value is tedious to assemble by hand, so the deployment states it.
  // These are public endpoints, not secrets.
  const origin = publicOrigin(req);
  const singleSignOn = listOAuthProviders().map((p) => ({
    provider: p.id,
    configured: p.configured,
    callbackUrl: redirectUri(p.id, origin),
  }));

  return NextResponse.json(
    {
      ok,
      checks: checks.map(({ name, ok: passed, detail }) => ({ name, ok: passed, detail })),
      singleSignOn,
      ...(ok ? {} : { hint: "Set the values named above in this deployment's environment, then redeploy." }),
    },
    // 503 when something is wrong, so an uptime check treats it as down rather than
    // reporting a healthy site that nobody can sign in to.
    { status: ok ? 200 : 503 },
  );
}
