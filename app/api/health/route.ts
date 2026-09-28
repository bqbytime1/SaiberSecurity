import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

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

export async function GET() {
  const checks = await runHealthChecks();
  const ok = checks.every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      checks: checks.map(({ name, ok: passed, detail }) => ({ name, ok: passed, detail })),
      ...(ok ? {} : { hint: "Set the values named above in this deployment's environment, then redeploy." }),
    },
    // 503 when something is wrong, so an uptime check treats it as down rather than
    // reporting a healthy site that nobody can sign in to.
    { status: ok ? 200 : 503 },
  );
}
