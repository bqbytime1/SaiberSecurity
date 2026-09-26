try {
  process.loadEnvFile?.(".env");
} catch {
  // .env is optional when DATABASE_URL is already in the environment
}

import bcrypt from "bcryptjs";
import { ingestEvents } from "../lib/ingest";
import { prisma } from "../lib/prisma";
import { createRng, generateDataset, PERSONAS, type Persona } from "../lib/synthetic";

export const DEMO_USER = {
  email: "demo@saibersecurity.com",
  // Published in this repository, so it is only ever acceptable where the site is not
  // reachable from the internet. Override with DEMO_USER_PASSWORD.
  password: process.env.DEMO_USER_PASSWORD || "SaiberDemo2026!",
  name: "Demo Analyst",
};

/**
 * Whether to create the built-in analyst account.
 *
 * Containers turn this off unless a password is supplied, because seeding a login
 * whose password is in a public repository would leave the door open on any
 * internet-facing deployment. The security data is still seeded either way; sign up
 * for your own account instead.
 */
const CREATE_DEMO_USER = process.env.SEED_DEMO_USER !== "false";

const HOUR = 3_600_000;

function persona(user: string): Persona {
  const p = PERSONAS.find((x) => x.user === user);
  if (!p) throw new Error(`Unknown persona ${user}`);
  return p;
}

/** Pick a timestamp `hoursAgo` back, nudged into the persona's active window so time-of-day is not a confounder. */
function withinActiveHours(now: Date, hoursAgo: number, p: Persona): Date {
  const d = new Date(now.getTime() - hoursAgo * HOUR);
  const [from, to] = p.activeHours;
  const h = d.getUTCHours();
  const active = from <= to ? h >= from && h <= to : h >= from || h <= to;
  if (active) return d;
  d.setUTCHours(from + 2, 15, 0, 0);
  if (d.getTime() > now.getTime() - 30 * 60_000) d.setTime(d.getTime() - 24 * HOUR);
  return d;
}

async function main() {
  console.log("SaiberSecurity — seeding database");
  const started = Date.now();

  // The seeded dataset belongs to one organization. An existing one is reused so
  // re-seeding refreshes that tenant rather than accumulating empty ones.
  const organization =
    (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
    (await prisma.organization.create({ data: { name: "Acme Corporation", detectionSensitivity: "MEDIUM" } }));
  const organizationId = organization.id;
  console.log(`✔ organization ${organization.name}`);

  if (CREATE_DEMO_USER) {
    const passwordHash = await bcrypt.hash(DEMO_USER.password, 12);
    await prisma.user.upsert({
      where: { email: DEMO_USER.email },
      update: { passwordHash, name: DEMO_USER.name },
      create: { email: DEMO_USER.email, passwordHash, name: DEMO_USER.name, organizationId },
    });
    console.log(`✔ demo user ${DEMO_USER.email}`);
  } else {
    console.log("• skipping the built-in demo account (SEED_DEMO_USER=false)");
    console.log("  create your own at /signup — the security data below is seeded regardless");
  }

  // Only this organization's data is cleared; any other tenant is left untouched.
  await prisma.securityEvent.deleteMany({ where: { organizationId } });
  await prisma.incident.deleteMany({ where: { organizationId } });
  console.log("✔ cleared previous events and incidents");

  const now = new Date();
  const rng = createRng(20260908);

  const alice = persona("alice.chen");
  const marcus = persona("marcus.reed");
  const james = persona("james.okafor");
  const priya = persona("priya.sharma");
  const sofia = persona("sofia.martinez");
  const daniel = persona("daniel.silva");
  const emma = persona("emma.johansson");
  const noah = persona("noah.kim");

  const events = generateDataset({
    rng,
    now,
    hours: 24 * 7,
    eventsPerPersonaHour: 1.6,
    scenarios: [
      // Older background incidents (some will be resolved below)
      { name: "unusual_location_login", at: withinActiveHours(now, 118, sofia), target: sofia },
      { name: "suspicious_process", at: withinActiveHours(now, 96, daniel), target: daniel },
      { name: "malware_detected", at: withinActiveHours(now, 71, emma), target: emma },
      { name: "repeated_failed_logins", at: new Date(now.getTime() - 52 * HOUR), target: noah, attackerIp: "91.240.118.172" },
      { name: "abnormal_api_volume", at: withinActiveHours(now, 31, priya), target: priya },
      { name: "unauthorized_access", at: withinActiveHours(now, 19, james), target: james },
      // The five headline incidents for the demo dashboard
      { name: "privilege_escalation", at: withinActiveHours(now, 9, marcus), target: marcus },
      { name: "abnormal_data_transfer", at: withinActiveHours(now, 5.5, james), target: james },
      { name: "credential_stuffing", at: new Date(now.getTime() - 3.2 * HOUR), attackerIp: "185.220.101.34" },
      { name: "port_scan", at: new Date(now.getTime() - 2.1 * HOUR), attackerIp: "194.26.29.101" },
      { name: "impossible_travel", at: new Date(now.getTime() - 1.4 * HOUR), target: alice },
    ],
  });
  console.log(`✔ generated ${events.length} synthetic events over 7 days`);

  let lastPct = -1;
  const summary = await ingestEvents(organizationId, events, {
    sensitivity: "MEDIUM",
    onProgress: (done: number, total: number) => {
      const pct = Math.floor((done / total) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  scoring & correlating… ${pct}%\r`);
      }
    },
  });
  process.stdout.write("\n");
  console.log(`✔ ingested ${summary.created} events (${summary.suspicious} suspicious)`);
  console.log(`✔ incidents created: ${summary.incidentsCreated}, updated: ${summary.incidentsUpdated}`);

  // Mark the oldest background incidents as handled so the incident table shows a realistic mix of statuses.
  const olderIncidents = await prisma.incident.findMany({
    where: { lastEventAt: { lt: new Date(now.getTime() - 40 * HOUR) } },
    orderBy: { lastEventAt: "asc" },
  });
  for (const [i, inc] of olderIncidents.entries()) {
    const status = i % 3 === 2 ? "FALSE_POSITIVE" : "RESOLVED";
    await prisma.incident.update({
      where: { id: inc.id },
      data: { status, resolvedAt: new Date(inc.lastEventAt.getTime() + (2 + i) * HOUR) },
    });
  }
  const recentHigh = await prisma.incident.findFirst({ where: { status: "OPEN", severity: "HIGH" }, orderBy: { createdAt: "asc" } });
  if (recentHigh) await prisma.incident.update({ where: { id: recentHigh.id }, data: { status: "INVESTIGATING" } });

  const incidents = await prisma.incident.findMany({ orderBy: { createdAt: "desc" }, select: { title: true, severity: true, riskScore: true, status: true, eventCount: true } });
  console.log("\nIncidents:");
  for (const i of incidents) console.log(`  [${i.severity.padEnd(8)}] ${String(i.riskScore).padStart(3)}  ${i.status.padEnd(14)} ${i.eventCount.toString().padStart(3)} ev  ${i.title}`);

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (CREATE_DEMO_USER) {
    console.log(`\nDemo login → ${DEMO_USER.email} / ${DEMO_USER.password}`);
  } else {
    console.log("\nNo built-in login was created. Sign up at /signup to get in.");
  }
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
