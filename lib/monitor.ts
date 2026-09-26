import "server-only";
import { ingestEvents } from "./ingest";
import { isHostMonitorSupported, mapSampleToEvents, sampleHost } from "./collectors/host-network";
import { prisma } from "./prisma";
import { serializeEvent, type EventDTO } from "./serializers";
import { getSensitivity } from "./settings";
import { HOST_AGENT_SOURCE } from "./types";

/**
 * Continuous host monitoring.
 *
 * A single interval lives in the Node process and polls the operating system on a
 * timer, so collection keeps running whether or not anyone has the console open. That
 * is the difference from the old "auto simulate" toggle, which only ticked while a
 * browser tab was in the foreground.
 *
 * State is intentionally in-process: one server, one collector. Running several app
 * instances against one database would need a lock so they do not all collect.
 */

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 5_000;

/** Remember recently reported connections so a long-lived socket is not re-emitted every poll. */
const SEEN_TTL_MS = 10 * 60_000;

export interface MonitorStatus {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  host: string | null;
  intervalMs: number;
  startedAt: string | null;
  lastPollAt: string | null;
  nextPollAt: string | null;
  lastDurationMs: number | null;
  polls: number;
  eventsCollected: number;
  incidentsCreated: number;
  /** Connections in the most recent sample, and how many of those left this machine. */
  connectionsSeen: number;
  externalConnections: number;
  trackedConnections: number;
  lastError: string | null;
}

interface MonitorState {
  timer: NodeJS.Timeout | null;
  running: boolean;
  intervalMs: number;
  host: string | null;
  startedAt: Date | null;
  lastPollAt: Date | null;
  lastDurationMs: number | null;
  polls: number;
  eventsCollected: number;
  incidentsCreated: number;
  connectionsSeen: number;
  externalConnections: number;
  lastError: string | null;
  organizationId: string | null;
  seen: Map<string, number>;
  polling: boolean;
}

// Survives dev-server hot reloads, which would otherwise leave orphaned intervals.
const globalForMonitor = globalThis as unknown as { __saiberMonitor?: MonitorState };

const state: MonitorState = (globalForMonitor.__saiberMonitor ??= {
  timer: null,
  running: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  host: null,
  startedAt: null,
  lastPollAt: null,
  lastDurationMs: null,
  polls: 0,
  eventsCollected: 0,
  incidentsCreated: 0,
  connectionsSeen: 0,
  externalConnections: 0,
  lastError: null,
  organizationId: null,
  seen: new Map(),
  polling: false,
});

export function isMonitorEnabled(): boolean {
  const flag = process.env.HOST_MONITOR_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  // Off by default in production: on a server this would report the server's own
  // outbound traffic, which is rarely what an operator expects to see.
  return process.env.NODE_ENV !== "production";
}

function configuredInterval(): number {
  const raw = Number(process.env.HOST_MONITOR_INTERVAL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

function pruneSeen(now: number) {
  for (const [key, at] of state.seen) if (now - at > SEEN_TTL_MS) state.seen.delete(key);
}

/**
 * Which organization the collector's events belong to.
 *
 * The collector runs on a timer with nobody signed in, so it cannot infer a tenant
 * from a request. HOST_MONITOR_ORG_ID names one explicitly; otherwise it reports to
 * the oldest organization, which on a single-operator deployment is the right one and
 * on a shared one makes the ambiguity obvious enough to configure.
 */
async function collectorOrganizationId(): Promise<string | null> {
  const configured = process.env.HOST_MONITOR_ORG_ID?.trim();
  if (configured) {
    const exists = await prisma.organization.findUnique({ where: { id: configured }, select: { id: true } });
    if (exists) return exists.id;
    console.warn(`[monitor] HOST_MONITOR_ORG_ID "${configured}" does not exist; falling back to the oldest organization`);
  }
  const oldest = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return oldest?.id ?? null;
}

/** One collection cycle: sample the host, ingest what is new, record what happened. */
export async function pollOnce(): Promise<{ collected: number; incidents: number; external: number }> {
  if (state.polling) return { collected: 0, incidents: 0, external: 0 };
  state.polling = true;
  const started = Date.now();

  try {
    const sample = await sampleHost();
    state.host = sample.host;

    if (sample.error) {
      state.lastError = sample.error;
      return { collected: 0, incidents: 0, external: 0 };
    }

    const mapped = mapSampleToEvents(sample, new Set(state.seen.keys()), sample.host);
    const now = Date.now();
    for (const key of mapped.keys) state.seen.set(key, now);
    pruneSeen(now);

    state.connectionsSeen = mapped.totalCount;
    state.externalConnections = mapped.externalCount;

    let incidents = 0;
    if (mapped.events.length > 0) {
      const organizationId = await collectorOrganizationId();
      if (!organizationId) {
        // Nobody has signed up yet, so there is no tenant to file these under. The
        // sample is simply dropped; the next poll after the first sign-up will land.
        state.lastError = "No organization exists yet — sign up before collection can store anything";
        return { collected: 0, incidents: 0, external: mapped.externalCount };
      }
      state.organizationId = organizationId;
      const summary = await ingestEvents(organizationId, mapped.events, { sensitivity: await getSensitivity(organizationId) });
      state.eventsCollected += summary.created;
      state.incidentsCreated += summary.incidentsCreated;
      incidents = summary.incidentsCreated;
    }

    state.lastError = null;
    return { collected: mapped.events.length, incidents, external: mapped.externalCount };
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    return { collected: 0, incidents: 0, external: 0 };
  } finally {
    state.polls++;
    state.lastPollAt = new Date();
    state.lastDurationMs = Date.now() - started;
    state.polling = false;
  }
}

export function startMonitor(): MonitorStatus {
  if (!isHostMonitorSupported()) return getMonitorStatus();
  if (state.running) return getMonitorStatus();

  state.intervalMs = configuredInterval();
  state.running = true;
  state.startedAt = new Date();

  // Collect immediately so the console has data within a second of boot.
  void pollOnce();
  state.timer = setInterval(() => void pollOnce(), state.intervalMs);
  // Do not hold the process open purely for collection.
  state.timer.unref?.();

  console.log(`[monitor] host collector started, polling every ${state.intervalMs / 1000}s`);
  return getMonitorStatus();
}

export function stopMonitor(): MonitorStatus {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  console.log("[monitor] host collector stopped");
  return getMonitorStatus();
}

export interface LiveSnapshot {
  status: MonitorStatus;
  totals: { collected: number; lastHour: number };
  recent: EventDTO[];
}

/**
 * Collector status plus the events it has produced. Lives here rather than in the page
 * so the time window is computed outside React's render phase, and so the page and the
 * API return exactly the same shape.
 */
export async function getLiveSnapshot(organizationId: string, limit = 40): Promise<LiveSnapshot> {
  const since = new Date(Date.now() - 3_600_000);
  const [recent, collected, lastHour] = await Promise.all([
    prisma.securityEvent.findMany({ where: { organizationId, source: HOST_AGENT_SOURCE }, orderBy: { timestamp: "desc" }, take: limit }),
    prisma.securityEvent.count({ where: { organizationId, source: HOST_AGENT_SOURCE } }),
    prisma.securityEvent.count({ where: { organizationId, source: HOST_AGENT_SOURCE, timestamp: { gte: since } } }),
  ]);

  return {
    status: getMonitorStatus(),
    totals: { collected, lastHour },
    recent: recent.map(serializeEvent),
  };
}

export function getMonitorStatus(): MonitorStatus {
  const next = state.running && state.lastPollAt ? new Date(state.lastPollAt.getTime() + state.intervalMs) : null;
  return {
    supported: isHostMonitorSupported(),
    enabled: isMonitorEnabled(),
    running: state.running,
    host: state.host,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt?.toISOString() ?? null,
    lastPollAt: state.lastPollAt?.toISOString() ?? null,
    nextPollAt: next?.toISOString() ?? null,
    lastDurationMs: state.lastDurationMs,
    polls: state.polls,
    eventsCollected: state.eventsCollected,
    incidentsCreated: state.incidentsCreated,
    connectionsSeen: state.connectionsSeen,
    externalConnections: state.externalConnections,
    trackedConnections: state.seen.size,
    lastError: state.lastError,
  };
}
