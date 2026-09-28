import { NextResponse } from "next/server";
import { sessionSecretProblem } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Map a Prisma failure to something an operator can act on.
 *
 * The raw error is logged rather than returned, because its message can include the
 * connection string.
 */
function describeDatabaseError(err: unknown): string {
  // Query errors carry `code`; the initialization error raised when the server cannot be
  // reached at all carries `errorCode` instead, and reading only `code` misses exactly
  // the case an operator most needs named.
  const e = err as { code?: string; errorCode?: string; message?: string };
  const code = e?.code ?? e?.errorCode;

  // Some driver-level failures arrive before Prisma assigns a code.
  if (!code && typeof e?.message === "string") {
    if (/ECONNREFUSED|Can't reach database server/i.test(e.message)) {
      return "the database server cannot be reached — check the host, the port, and that it accepts connections from this network";
    }
    if (/ENOTFOUND|getaddrinfo/i.test(e.message)) {
      return "the host in DATABASE_URL does not resolve";
    }
    if (/ETIMEDOUT|timed out/i.test(e.message)) {
      return "the connection timed out — usually a firewall or security group blocking this network";
    }
    if (/does not exist in the current database|relation .* does not exist/i.test(e.message)) {
      return "the tables are missing — migrations have not been applied to this database";
    }
  }

  switch (code) {
    case "P1000":
      return "the database rejected the credentials in DATABASE_URL";
    case "P1001":
      return "the database server cannot be reached — check the host, the port, and that it accepts connections from this network";
    case "P1002":
      return "the database server timed out";
    case "P1003":
      return "the database named in DATABASE_URL does not exist";
    case "P1017":
      return "the database closed the connection";
    case "P2021":
    case "P2022":
      return "the tables are missing — migrations have not been applied to this database";
    default:
      return "the database could not be queried; see the server log for the driver error";
  }
}

async function checkDatabase(): Promise<Check> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return { name: "database", ok: false, detail: "DATABASE_URL is not set" };
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    return { name: "database", ok: false, detail: "DATABASE_URL is not a PostgreSQL connection string" };
  }

  try {
    // Two different questions: can we reach the server at all, and has the schema been
    // applied? A reachable database with no tables is the usual state when migrations
    // were never run, and it fails only once something reads a table.
    await prisma.$queryRaw`SELECT 1`;
    await prisma.user.count();
    return { name: "database", ok: true, detail: "reachable, schema applied" };
  } catch (err) {
    console.error("[health] database check failed", err);
    return { name: "database", ok: false, detail: describeDatabaseError(err) };
  }
}

export async function GET() {
  const secretProblem = sessionSecretProblem();
  const checks: Check[] = [
    {
      name: "sessionSecret",
      ok: !secretProblem,
      // Sign-in and sign-up both fail without this, because both issue a session.
      detail: secretProblem ?? "set, and long enough",
    },
    await checkDatabase(),
  ];

  const ok = checks.every((c) => c.ok);
  return NextResponse.json(
    {
      ok,
      checks,
      ...(ok ? {} : { hint: "Set the values named above in this deployment's environment, then redeploy." }),
    },
    // 503 when something is wrong, so an uptime check treats it as down rather than
    // reporting a healthy site that nobody can sign in to.
    { status: ok ? 200 : 503 },
  );
}
