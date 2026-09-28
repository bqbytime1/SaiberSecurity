import "server-only";
import { sessionSecretProblem } from "./auth";
import { prisma } from "./prisma";

/**
 * Whether this deployment can actually work, and if not, what is wrong.
 *
 * Shared by /api/health and the sign-in and sign-up pages, so the same diagnosis appears
 * whether you query it or simply arrive at the page that is failing.
 */

export interface Check {
  name: string;
  label: string;
  ok: boolean;
  /** A description of the fault. Never a value, a secret, or a raw driver error. */
  detail: string;
}

/**
 * Map a Prisma failure to something an operator can act on.
 *
 * The raw error is logged rather than returned, because its message can include the
 * connection string, and therefore the database password.
 */
export function describeDatabaseError(err: unknown): string {
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
  const base = { name: "database", label: "Database" };
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return { ...base, ok: false, detail: "DATABASE_URL is not set" };
  if (!/^postgres(ql)?:\/\//.test(url)) {
    return { ...base, ok: false, detail: "DATABASE_URL is not a PostgreSQL connection string" };
  }

  try {
    // Two different questions: can the server be reached at all, and has the schema been
    // applied? A reachable database with no tables is the usual state when migrations
    // were never run, and it fails only once something reads a table.
    await prisma.$queryRaw`SELECT 1`;
    await prisma.user.count();
    return { ...base, ok: true, detail: "reachable, schema applied" };
  } catch (err) {
    console.error("[health] database check failed", err);
    return { ...base, ok: false, detail: describeDatabaseError(err) };
  }
}

export async function runHealthChecks(): Promise<Check[]> {
  const secretProblem = sessionSecretProblem();
  return [
    {
      name: "sessionSecret",
      label: "Session secret",
      ok: !secretProblem,
      // Sign-in and sign-up both fail without this, because both issue a session.
      detail: secretProblem ?? "set, and long enough",
    },
    await checkDatabase(),
  ];
}
