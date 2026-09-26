import "server-only";
import { isPrivateAddress } from "./collectors/host-network";
import { prisma } from "./prisma";
import { serializeEvent, serializeIncident, type EventDTO, type IncidentDTO } from "./serializers";
import { HOST_AGENT_SOURCE } from "./types";

/**
 * Detail report for a single observed connection.
 *
 * Everything here is derived from events the collector already stored. Nothing is
 * inferred that the data does not support: there is no geo-location, no reputation
 * lookup and no payload, because the collector samples the OS connection table rather
 * than capturing traffic.
 */

/** How much recent host telemetry to pull when aggregating per-process history. */
const PROCESS_SCAN_LIMIT = 4000;

export interface ConnectionPeer {
  address: string;
  resolvedHost: string | null;
  count: number;
  lastSeen: string;
  maxRisk: number;
}

export interface ConnectionReport {
  event: EventDTO;
  incident: IncidentDTO | null;

  process: string;
  pid: number | null;
  remotePort: number | null;
  localPort: number | null;
  resolvedHost: string | null;
  commonPort: boolean;
  isPrivateDestination: boolean;

  /** History of this machine talking to this particular remote address. */
  destination: {
    total: number;
    firstSeen: string | null;
    lastSeen: string | null;
    maxRisk: number;
    processes: Array<{ name: string; count: number }>;
    ports: number[];
  };

  /** History of this process opening connections at all. */
  processHistory: {
    total: number;
    distinctDestinations: number;
    firstSeen: string | null;
    lastSeen: string | null;
    maxRisk: number;
    topPeers: ConnectionPeer[];
  };

  /** Other recent connections to the same destination, newest first. */
  related: EventDTO[];
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function getConnectionReport(id: string): Promise<ConnectionReport | null> {
  const row = await prisma.securityEvent.findUnique({ where: { id }, include: { incident: true } });
  if (!row || row.source !== HOST_AGENT_SOURCE) return null;

  const { incident, ...rest } = row;
  const event = serializeEvent(rest);
  const meta = event.metadata;
  const process = metaString(meta, "process") ?? "unknown";
  const destinationIp = event.destinationIp;

  // Everything this machine has sent to the same remote address.
  const sameDestination = destinationIp
    ? await prisma.securityEvent.findMany({
        where: { source: HOST_AGENT_SOURCE, destinationIp },
        orderBy: { timestamp: "desc" },
        take: 500,
      })
    : [];

  const destProcesses = new Map<string, number>();
  const destPorts = new Set<number>();
  let destMaxRisk = 0;
  for (const e of sameDestination) {
    const m = serializeEvent(e).metadata;
    const p = metaString(m, "process") ?? "unknown";
    destProcesses.set(p, (destProcesses.get(p) ?? 0) + 1);
    const port = metaNumber(m, "remotePort");
    if (port) destPorts.add(port);
    if (e.riskScore > destMaxRisk) destMaxRisk = e.riskScore;
  }

  // Per-process aggregation is done in memory: the process name lives inside a JSON
  // column, and matching it with SQL LIKE would treat characters such as % as
  // wildcards and quietly over-count.
  const recentHostEvents = await prisma.securityEvent.findMany({
    where: { source: HOST_AGENT_SOURCE },
    orderBy: { timestamp: "desc" },
    take: PROCESS_SCAN_LIMIT,
  });

  const peers = new Map<string, ConnectionPeer>();
  let processTotal = 0;
  let processMaxRisk = 0;
  let processFirst: Date | null = null;
  let processLast: Date | null = null;

  for (const e of recentHostEvents) {
    const m = serializeEvent(e).metadata;
    if ((metaString(m, "process") ?? "unknown") !== process) continue;
    processTotal++;
    if (e.riskScore > processMaxRisk) processMaxRisk = e.riskScore;
    if (!processFirst || e.timestamp < processFirst) processFirst = e.timestamp;
    if (!processLast || e.timestamp > processLast) processLast = e.timestamp;

    const addr = e.destinationIp;
    if (!addr) continue;
    const existing = peers.get(addr);
    if (existing) {
      existing.count++;
      if (e.riskScore > existing.maxRisk) existing.maxRisk = e.riskScore;
    } else {
      peers.set(addr, {
        address: addr,
        resolvedHost: metaString(m, "resolvedHost"),
        count: 1,
        lastSeen: e.timestamp.toISOString(),
        maxRisk: e.riskScore,
      });
    }
  }

  const timestamps = sameDestination.map((e) => e.timestamp);
  const firstSeen = timestamps.length ? new Date(Math.min(...timestamps.map((t) => t.getTime()))) : null;
  const lastSeen = timestamps.length ? new Date(Math.max(...timestamps.map((t) => t.getTime()))) : null;

  return {
    event,
    incident: incident ? serializeIncident(incident) : null,
    process,
    pid: metaNumber(meta, "pid"),
    remotePort: metaNumber(meta, "remotePort"),
    localPort: metaNumber(meta, "localPort"),
    resolvedHost: metaString(meta, "resolvedHost"),
    commonPort: meta.commonPort === true,
    isPrivateDestination: destinationIp ? isPrivateAddress(destinationIp) : false,
    destination: {
      total: sameDestination.length,
      firstSeen: firstSeen?.toISOString() ?? null,
      lastSeen: lastSeen?.toISOString() ?? null,
      maxRisk: destMaxRisk,
      processes: [...destProcesses.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      ports: [...destPorts].sort((a, b) => a - b),
    },
    processHistory: {
      total: processTotal,
      distinctDestinations: peers.size,
      firstSeen: processFirst?.toISOString() ?? null,
      lastSeen: processLast?.toISOString() ?? null,
      maxRisk: processMaxRisk,
      topPeers: [...peers.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    },
    related: sameDestination
      .filter((e) => e.id !== id)
      .slice(0, 20)
      .map(serializeEvent),
  };
}
