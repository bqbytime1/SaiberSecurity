import type { SecurityEvent } from "@prisma/client";
import { prisma } from "./prisma";
import { EMPTY_CONTEXT, scoreEvent, SUSPICIOUS_THRESHOLD, type EventContext } from "./anomaly";
import { correlateEvent } from "./correlation";
import { getSensitivity } from "./settings";
import type { EventMetadata, RawSecurityEvent, Sensitivity } from "./types";
import { safeJsonParse } from "./utils";

const MIN = 60_000;
const HOUR = 60 * MIN;
const BASELINE_DAYS = 30;

interface UserBaseline {
  homeCountry: string | null;
  countryCount: number;
  activeHours: number[];
  meanDownloadBytes: number | null;
  stdDownloadBytes: number | null;
  meanApiRequests: number | null;
}

/**
 * Baselines change slowly, so within one ingest batch they are computed once per
 * user (as of the batch start) instead of once per event.
 */
class BaselineCache {
  private cache = new Map<string, Promise<UserBaseline>>();
  constructor(
    private readonly organizationId: string,
    private readonly asOf: Date,
  ) {}

  get(user: string): Promise<UserBaseline> {
    let p = this.cache.get(user);
    if (!p) {
      p = computeUserBaseline(this.organizationId, user, this.asOf);
      this.cache.set(user, p);
    }
    return p;
  }
}

async function computeUserBaseline(organizationId: string, user: string, asOf: Date): Promise<UserBaseline> {
  const since = new Date(asOf.getTime() - BASELINE_DAYS * 24 * HOUR);
  const rows = await prisma.securityEvent.findMany({
    where: { organizationId, user, timestamp: { gte: since, lt: asOf }, anomalyScore: { lt: SUSPICIOUS_THRESHOLD } },
    select: { country: true, timestamp: true, eventType: true, metadata: true },
    take: 3000,
    orderBy: { timestamp: "desc" },
  });

  const countryCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  const downloads: number[] = [];
  const apiCounts: number[] = [];
  for (const r of rows) {
    if (r.country) countryCounts.set(r.country, (countryCounts.get(r.country) ?? 0) + 1);
    const h = r.timestamp.getUTCHours();
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
    const meta = safeJsonParse<EventMetadata>(r.metadata, {});
    if (r.eventType === "data_download" && typeof meta.bytes === "number") downloads.push(meta.bytes);
    if (r.eventType === "unusual_api_request" && typeof meta.requestCount === "number") apiCounts.push(meta.requestCount);
  }

  const homeCountry = [...countryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // Active hours: any hour holding at least 3% of the user's activity (needs a minimum sample)
  const total = rows.length;
  const activeHours = total >= 20 ? [...hourCounts.entries()].filter(([, c]) => c / total >= 0.03).map(([h]) => h) : [];

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const std = (xs: number[], m: number | null) => (xs.length >= 3 && m !== null ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) : null);
  const meanDownloadBytes = downloads.length >= 3 ? mean(downloads) : null;

  return {
    homeCountry,
    countryCount: countryCounts.size,
    activeHours,
    meanDownloadBytes,
    stdDownloadBytes: std(downloads, meanDownloadBytes),
    meanApiRequests: apiCounts.length >= 3 ? mean(apiCounts) : null,
  };
}

async function buildContext(organizationId: string, event: RawSecurityEvent, baselines: BaselineCache): Promise<EventContext> {
  const t = event.timestamp;
  const t15 = new Date(t.getTime() - 15 * MIN);
  const t30 = new Date(t.getTime() - 30 * MIN);
  const t60 = new Date(t.getTime() - 60 * MIN);
  const t24h = new Date(t.getTime() - 24 * HOUR);

  const [ipFailed, ipEventsLastHour, ipSuspiciousLastHour, ipFlagged, ipPortScans, userStuff, baseline] = await Promise.all([
    prisma.securityEvent.findMany({
      where: { organizationId, sourceIp: event.sourceIp, eventType: { in: ["failed_login", "credential_attack"] }, timestamp: { gte: t15, lt: t } },
      select: { user: true },
    }),
    prisma.securityEvent.count({ where: { organizationId, sourceIp: event.sourceIp, timestamp: { gte: t60, lt: t } } }),
    prisma.securityEvent.count({ where: { organizationId, sourceIp: event.sourceIp, timestamp: { gte: t60, lt: t }, anomalyScore: { gte: SUSPICIOUS_THRESHOLD } } }),
    prisma.securityEvent.count({ where: { organizationId, sourceIp: event.sourceIp, timestamp: { gte: t24h, lt: t60 }, anomalyScore: { gte: 55 } } }),
    prisma.securityEvent.count({ where: { organizationId, sourceIp: event.sourceIp, eventType: "port_scan", timestamp: { gte: t15, lt: t } } }),
    event.user
      ? Promise.all([
          prisma.securityEvent.count({ where: { organizationId, user: event.user, eventType: { in: ["failed_login", "credential_attack"] }, timestamp: { gte: t30, lt: t } } }),
          prisma.securityEvent.findFirst({
            where: { organizationId, user: event.user, eventType: { in: ["successful_login", "impossible_travel"] }, country: { not: null }, timestamp: { lt: t } },
            orderBy: { timestamp: "desc" },
            select: { country: true, timestamp: true },
          }),
          prisma.securityEvent.count({ where: { organizationId, user: event.user, eventType: "privilege_escalation", timestamp: { gte: t60, lt: t } } }),
          prisma.securityEvent.count({ where: { organizationId, user: event.user, eventType: "successful_login", timestamp: { gte: t60, lt: t } } }),
        ])
      : Promise.resolve([0, null, 0, 0] as const),
    event.user ? baselines.get(event.user) : Promise.resolve(null),
  ]);

  const [userFailed, prevLocation, privCount, loginCount] = userStuff;

  return {
    ...EMPTY_CONTEXT,
    ipFailedAuthLast15m: ipFailed.length,
    ipDistinctUsersLast15m: new Set(ipFailed.map((r) => r.user).filter(Boolean)).size,
    userFailedAuthLast30m: userFailed,
    ipEventsLastHour,
    ipSuspiciousLastHour,
    ipPreviouslyFlagged: ipFlagged > 0,
    ipPortScanLast15m: ipPortScans,
    userHomeCountry: baseline?.homeCountry ?? null,
    userCountryCount: baseline?.countryCount ?? 0,
    userActiveHours: baseline?.activeHours ?? [],
    userMeanDownloadBytes: baseline?.meanDownloadBytes ?? null,
    userStdDownloadBytes: baseline?.stdDownloadBytes ?? null,
    userMeanApiRequests: baseline?.meanApiRequests ?? null,
    userPreviousLocation: prevLocation?.country ? { country: prevLocation.country, timestamp: prevLocation.timestamp } : null,
    userRecentPrivilegeEscalation: privCount > 0,
    userRecentSuccessfulLogin: loginCount > 0,
  };
}

export interface IngestSummary {
  created: number;
  suspicious: number;
  incidentsCreated: number;
  incidentsUpdated: number;
  incidentIds: string[];
  events: SecurityEvent[];
}

export interface IngestOptions {
  sensitivity?: Sensitivity;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Score, persist and correlate a batch of raw events for one organization. Events are
 * processed in timestamp order so that frequency-based context reflects preceding
 * events, and all of that context is drawn from the same organization: one tenant's
 * traffic must never influence another's baselines or scores.
 */
export async function ingestEvents(organizationId: string, raw: RawSecurityEvent[], opts: IngestOptions = {}): Promise<IngestSummary> {
  const sensitivity = opts.sensitivity ?? (await getSensitivity(organizationId));
  const ordered = [...raw].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const asOf = ordered[0]?.timestamp ?? new Date();
  const baselines = new BaselineCache(organizationId, asOf);

  const summary: IngestSummary = { created: 0, suspicious: 0, incidentsCreated: 0, incidentsUpdated: 0, incidentIds: [], events: [] };
  const touched = new Set<string>();

  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    const ctx = await buildContext(organizationId, e, baselines);
    const score = scoreEvent(e, ctx, sensitivity);

    const stored = await prisma.securityEvent.create({
      data: {
        organizationId,
        timestamp: e.timestamp,
        source: e.source,
        eventType: e.eventType,
        user: e.user ?? null,
        sourceIp: e.sourceIp,
        destinationIp: e.destinationIp ?? null,
        country: e.country ?? null,
        device: e.device ?? null,
        action: e.action,
        status: e.status,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
        anomalyScore: score.anomalyScore,
        riskScore: score.riskScore,
        severity: score.severity,
        scoreFactors: JSON.stringify(score.factors),
      },
    });
    summary.created++;
    summary.events.push(stored);

    if (score.anomalyScore >= SUSPICIOUS_THRESHOLD) {
      summary.suspicious++;
      const { incident, created } = await correlateEvent(stored, score.factors);
      if (incident) {
        if (created) summary.incidentsCreated++;
        else summary.incidentsUpdated++;
        touched.add(incident.id);
      }
    }
    opts.onProgress?.(i + 1, ordered.length);
  }

  summary.incidentIds = [...touched];
  return summary;
}
