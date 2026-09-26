import { prisma } from "./prisma";
import { SUSPICIOUS_THRESHOLD } from "./anomaly";
import { EVENT_TYPE_LABELS, EVENT_TYPE_SHORT_LABELS, type EventType, type Severity, type ThreatLevel } from "./types";

const HOUR = 3_600_000;

export interface TimeBucket {
  time: string;
  hour: string;
  total: number;
  suspicious: number;
  avgRisk: number;
  maxRisk: number;
}

export interface DashboardMetrics {
  generatedAt: string;
  threatLevel: ThreatLevel;
  threatReasons: string[];
  threatFocus: ThreatFocus;
  totals: {
    totalEvents: number;
    eventsToday: number;
    eventsLast24h: number;
    activeIncidents: number;
    criticalIncidents: number;
    highRiskEvents: number;
    suspiciousLast24h: number;
  };
  eventsOverTime: TimeBucket[];
  eventsBySeverity: Array<{ severity: Severity; count: number }>;
  eventsByType: Array<{ eventType: EventType; label: string; shortLabel: string; count: number; suspicious: number }>;
  topSuspiciousIps: Array<{ sourceIp: string; country: string | null; count: number; maxRisk: number; avgRisk: number }>;
  topAffectedUsers: Array<{ user: string; count: number; maxRisk: number; incidents: number }>;
  recentIncidents: Array<{
    id: string;
    title: string;
    severity: Severity;
    riskScore: number;
    status: string;
    eventCount: number;
    affectedUser: string | null;
    createdAt: string;
  }>;
}

/** Where the dashboard should send someone who clicks the threat level. */
export interface ThreatFocus {
  href: string;
  label: string;
}

/**
 * Resolve the threat level to the thing that caused it.
 *
 * A single driving incident deep-links to that incident; several link to the filtered
 * incident queue; a level driven by raw event volume rather than any incident links to
 * the matching events instead.
 */
function focusFor(driving: Array<{ id: string; title: string }>, severity: Severity, eventFallback: ThreatFocus | null): ThreatFocus {
  if (driving.length === 1) {
    return { href: `/incidents/${driving[0].id}`, label: `Investigate ${driving[0].title}` };
  }
  if (driving.length > 1) {
    // No count in the label: the queue filters on severity alone, so it also lists
    // resolved incidents and would contradict a number promised here. The reason
    // bullets above the button already state how many are actually open.
    return { href: `/incidents?severity=${severity}`, label: `Review ${severity.toLowerCase()}-severity incidents` };
  }
  return eventFallback ?? { href: "/incidents", label: "Review all incidents" };
}

export async function computeThreatLevel(now = new Date()): Promise<{ level: ThreatLevel; reasons: string[]; focus: ThreatFocus }> {
  const since24h = new Date(now.getTime() - 24 * HOUR);
  const since1h = new Date(now.getTime() - HOUR);
  const [openIncidents, criticalEventsLastHour, highEventsLast24h, recentEvents] = await Promise.all([
    prisma.incident.findMany({
      where: { status: { in: ["OPEN", "INVESTIGATING"] }, createdAt: { gte: since24h } },
      select: { id: true, title: true, severity: true, riskScore: true },
      orderBy: [{ riskScore: "desc" }],
    }),
    prisma.securityEvent.count({ where: { timestamp: { gte: since1h }, severity: "CRITICAL" } }),
    prisma.securityEvent.count({ where: { timestamp: { gte: since24h }, severity: { in: ["HIGH", "CRITICAL"] } } }),
    prisma.securityEvent.aggregate({ where: { timestamp: { gte: since1h } }, _avg: { riskScore: true }, _count: true }),
  ]);
  const criticalIncidents = openIncidents.filter((i) => i.severity === "CRITICAL");
  const highIncidents = openIncidents.filter((i) => i.severity === "HIGH");
  const mediumIncidents = openIncidents.filter((i) => i.severity === "MEDIUM");
  const critical = criticalIncidents.length;
  const high = highIncidents.length;
  const medium = mediumIncidents.length;
  const avgRisk = recentEvents._avg.riskScore ?? 0;

  const reasons: string[] = [];
  let level: ThreatLevel = "NORMAL";
  let focus: ThreatFocus;

  if (critical > 0 || criticalEventsLastHour >= 3) {
    level = "CRITICAL";
    if (critical) reasons.push(`${critical} open critical incident${critical === 1 ? "" : "s"}`);
    if (criticalEventsLastHour >= 3) reasons.push(`${criticalEventsLastHour} critical events in the last hour`);
    focus = focusFor(criticalIncidents, "CRITICAL", { href: "/events?severity=CRITICAL", label: "Review critical events" });
  } else if (high >= 2 || criticalEventsLastHour >= 1 || avgRisk >= 40) {
    level = "HIGH";
    if (high) reasons.push(`${high} open high-severity incident${high === 1 ? "" : "s"}`);
    if (criticalEventsLastHour) reasons.push(`${criticalEventsLastHour} critical event${criticalEventsLastHour === 1 ? "" : "s"} in the last hour`);
    if (avgRisk >= 40) reasons.push(`Average risk ${Math.round(avgRisk)} over the last hour`);
    focus = focusFor(
      highIncidents,
      "HIGH",
      criticalEventsLastHour > 0
        ? { href: "/events?severity=CRITICAL", label: "Review critical events" }
        : { href: "/events?minRisk=55", label: "Review high-risk events" },
    );
  } else if (high >= 1 || medium >= 3 || highEventsLast24h >= 10) {
    level = "ELEVATED";
    if (high) reasons.push(`${high} open high-severity incident`);
    if (medium >= 3) reasons.push(`${medium} open medium-severity incidents`);
    if (highEventsLast24h >= 10) reasons.push(`${highEventsLast24h} high-risk events in 24h`);
    focus =
      high >= 1
        ? focusFor(highIncidents, "HIGH", null)
        : medium >= 3
          ? focusFor(mediumIncidents, "MEDIUM", null)
          : { href: "/events?minRisk=55", label: "Review high-risk events" };
  } else {
    reasons.push("No open high or critical incidents in the last 24 hours");
    if (recentEvents._count) reasons.push(`Average risk ${Math.round(avgRisk)} over the last hour`);
    focus = { href: "/incidents", label: "Review all incidents" };
  }
  return { level, reasons, focus };
}

function bucketize(events: Array<{ timestamp: Date; riskScore: number; anomalyScore: number }>, hours: number, now: Date): TimeBucket[] {
  const start = Math.floor((now.getTime() - (hours - 1) * HOUR) / HOUR) * HOUR;
  const buckets: TimeBucket[] = Array.from({ length: hours }, (_, i) => {
    const d = new Date(start + i * HOUR);
    return { time: d.toISOString(), hour: `${String(d.getUTCHours()).padStart(2, "0")}:00`, total: 0, suspicious: 0, avgRisk: 0, maxRisk: 0 };
  });
  const sums = new Array(hours).fill(0);
  for (const e of events) {
    const idx = Math.floor((e.timestamp.getTime() - start) / HOUR);
    if (idx < 0 || idx >= hours) continue;
    const b = buckets[idx];
    b.total++;
    if (e.anomalyScore >= SUSPICIOUS_THRESHOLD) b.suspicious++;
    if (e.riskScore > b.maxRisk) b.maxRisk = e.riskScore;
    sums[idx] += e.riskScore;
  }
  buckets.forEach((b, i) => (b.avgRisk = b.total ? Math.round(sums[i] / b.total) : 0));
  return buckets;
}

export async function getDashboardMetrics(now = new Date()): Promise<DashboardMetrics> {
  const since24h = new Date(now.getTime() - 24 * HOUR);
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [
    totalEvents,
    eventsToday,
    eventsLast24h,
    activeIncidents,
    criticalIncidents,
    highRiskEvents,
    suspiciousLast24h,
    last24hEvents,
    severityGroups,
    typeGroups,
    typeSuspiciousGroups,
    suspiciousEvents,
    recentIncidents,
    threat,
  ] = await Promise.all([
    prisma.securityEvent.count(),
    prisma.securityEvent.count({ where: { timestamp: { gte: startOfDay } } }),
    prisma.securityEvent.count({ where: { timestamp: { gte: since24h } } }),
    prisma.incident.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
    prisma.incident.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] }, severity: "CRITICAL" } }),
    prisma.securityEvent.count({ where: { riskScore: { gte: 55 } } }),
    prisma.securityEvent.count({ where: { timestamp: { gte: since24h }, anomalyScore: { gte: SUSPICIOUS_THRESHOLD } } }),
    prisma.securityEvent.findMany({ where: { timestamp: { gte: since24h } }, select: { timestamp: true, riskScore: true, anomalyScore: true } }),
    prisma.securityEvent.groupBy({ by: ["severity"], _count: { _all: true } }),
    prisma.securityEvent.groupBy({ by: ["eventType"], _count: { _all: true } }),
    prisma.securityEvent.groupBy({ by: ["eventType"], where: { anomalyScore: { gte: SUSPICIOUS_THRESHOLD } }, _count: { _all: true } }),
    prisma.securityEvent.findMany({
      where: { anomalyScore: { gte: SUSPICIOUS_THRESHOLD } },
      select: { sourceIp: true, country: true, user: true, riskScore: true, incidentId: true },
      orderBy: { timestamp: "desc" },
      take: 5000,
    }),
    prisma.incident.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 8,
      select: { id: true, title: true, severity: true, riskScore: true, status: true, eventCount: true, affectedUser: true, createdAt: true },
    }),
    computeThreatLevel(now),
  ]);

  const severityOrder: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const eventsBySeverity = severityOrder.map((s) => ({ severity: s, count: severityGroups.find((g) => g.severity === s)?._count._all ?? 0 }));

  const suspiciousByType = new Map(typeSuspiciousGroups.map((g) => [g.eventType, g._count._all]));
  const eventsByType = typeGroups
    .map((g) => ({
      eventType: g.eventType as EventType,
      label: EVENT_TYPE_LABELS[g.eventType as EventType] ?? g.eventType,
      shortLabel: EVENT_TYPE_SHORT_LABELS[g.eventType as EventType] ?? g.eventType,
      count: g._count._all,
      suspicious: suspiciousByType.get(g.eventType) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  const ipAgg = new Map<string, { country: string | null; count: number; maxRisk: number; sum: number }>();
  const userAgg = new Map<string, { count: number; maxRisk: number; incidents: Set<string> }>();
  for (const e of suspiciousEvents) {
    const ip = ipAgg.get(e.sourceIp) ?? { country: e.country, count: 0, maxRisk: 0, sum: 0 };
    ip.count++;
    ip.sum += e.riskScore;
    ip.maxRisk = Math.max(ip.maxRisk, e.riskScore);
    ipAgg.set(e.sourceIp, ip);
    if (e.user) {
      const u = userAgg.get(e.user) ?? { count: 0, maxRisk: 0, incidents: new Set<string>() };
      u.count++;
      u.maxRisk = Math.max(u.maxRisk, e.riskScore);
      if (e.incidentId) u.incidents.add(e.incidentId);
      userAgg.set(e.user, u);
    }
  }
  const topSuspiciousIps = [...ipAgg.entries()]
    .map(([sourceIp, v]) => ({ sourceIp, country: v.country, count: v.count, maxRisk: v.maxRisk, avgRisk: Math.round(v.sum / v.count) }))
    .sort((a, b) => b.maxRisk * 1000 + b.count - (a.maxRisk * 1000 + a.count))
    .slice(0, 8);
  const topAffectedUsers = [...userAgg.entries()]
    .map(([user, v]) => ({ user, count: v.count, maxRisk: v.maxRisk, incidents: v.incidents.size }))
    .sort((a, b) => b.incidents * 1000 + b.maxRisk - (a.incidents * 1000 + a.maxRisk))
    .slice(0, 8);

  return {
    generatedAt: now.toISOString(),
    threatLevel: threat.level,
    threatReasons: threat.reasons,
    threatFocus: threat.focus,
    totals: { totalEvents, eventsToday, eventsLast24h, activeIncidents, criticalIncidents, highRiskEvents, suspiciousLast24h },
    eventsOverTime: bucketize(last24hEvents, 24, now),
    eventsBySeverity,
    eventsByType,
    topSuspiciousIps,
    topAffectedUsers,
    recentIncidents: recentIncidents.map((i) => ({ ...i, severity: i.severity as Severity, createdAt: i.createdAt.toISOString() })),
  };
}

export interface AnalyticsData {
  generatedAt: string;
  windowHours: number;
  anomalyRate: number;
  averageRiskScore: number;
  averageAnomalyScore: number;
  totalEvents: number;
  suspiciousEvents: number;
  incidentsBySeverity: Array<{ severity: Severity; open: number; resolved: number; total: number }>;
  incidentsByStatus: Array<{ status: string; count: number }>;
  eventsPerHour: TimeBucket[];
  topAttackTypes: Array<{ eventType: EventType; label: string; shortLabel: string; count: number; avgRisk: number }>;
  suspiciousIps: DashboardMetrics["topSuspiciousIps"];
  affectedUsers: DashboardMetrics["topAffectedUsers"];
  riskDistribution: Array<{ bucket: string; count: number }>;
  meanTimeToResolveMin: number | null;
}

export async function getAnalytics(now = new Date(), windowHours = 72): Promise<AnalyticsData> {
  const since = new Date(now.getTime() - windowHours * HOUR);
  const [windowEvents, incidents, suspiciousEvents] = await Promise.all([
    prisma.securityEvent.findMany({ where: { timestamp: { gte: since } }, select: { timestamp: true, riskScore: true, anomalyScore: true, eventType: true } }),
    prisma.incident.findMany({ select: { severity: true, status: true, createdAt: true, resolvedAt: true } }),
    prisma.securityEvent.findMany({
      where: { timestamp: { gte: since }, anomalyScore: { gte: SUSPICIOUS_THRESHOLD } },
      select: { sourceIp: true, country: true, user: true, riskScore: true, incidentId: true, eventType: true },
      take: 5000,
    }),
  ]);

  const total = windowEvents.length;
  const suspicious = windowEvents.filter((e) => e.anomalyScore >= SUSPICIOUS_THRESHOLD).length;
  const averageRiskScore = total ? Math.round(windowEvents.reduce((s, e) => s + e.riskScore, 0) / total) : 0;
  const averageAnomalyScore = total ? Math.round(windowEvents.reduce((s, e) => s + e.anomalyScore, 0) / total) : 0;

  const severityOrder: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const incidentsBySeverity = severityOrder.map((s) => {
    const rows = incidents.filter((i) => i.severity === s);
    const open = rows.filter((i) => i.status === "OPEN" || i.status === "INVESTIGATING").length;
    return { severity: s, open, resolved: rows.length - open, total: rows.length };
  });
  const statusOrder = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];
  const incidentsByStatus = statusOrder.map((status) => ({ status, count: incidents.filter((i) => i.status === status).length }));

  const typeAgg = new Map<string, { count: number; sum: number }>();
  for (const e of suspiciousEvents) {
    const t = typeAgg.get(e.eventType) ?? { count: 0, sum: 0 };
    t.count++;
    t.sum += e.riskScore;
    typeAgg.set(e.eventType, t);
  }
  const topAttackTypes = [...typeAgg.entries()]
    .map(([eventType, v]) => ({
      eventType: eventType as EventType,
      label: EVENT_TYPE_LABELS[eventType as EventType] ?? eventType,
      shortLabel: EVENT_TYPE_SHORT_LABELS[eventType as EventType] ?? eventType,
      count: v.count,
      avgRisk: Math.round(v.sum / v.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const ipAgg = new Map<string, { country: string | null; count: number; maxRisk: number; sum: number }>();
  const userAgg = new Map<string, { count: number; maxRisk: number; incidents: Set<string> }>();
  for (const e of suspiciousEvents) {
    const ip = ipAgg.get(e.sourceIp) ?? { country: e.country, count: 0, maxRisk: 0, sum: 0 };
    ip.count++;
    ip.sum += e.riskScore;
    ip.maxRisk = Math.max(ip.maxRisk, e.riskScore);
    ipAgg.set(e.sourceIp, ip);
    if (e.user) {
      const u = userAgg.get(e.user) ?? { count: 0, maxRisk: 0, incidents: new Set<string>() };
      u.count++;
      u.maxRisk = Math.max(u.maxRisk, e.riskScore);
      if (e.incidentId) u.incidents.add(e.incidentId);
      userAgg.set(e.user, u);
    }
  }

  const riskBuckets = ["0-19", "20-39", "40-59", "60-79", "80-100"];
  const riskDistribution = riskBuckets.map((bucket) => ({ bucket, count: 0 }));
  for (const e of windowEvents) riskDistribution[Math.min(4, Math.floor(e.riskScore / 20))].count++;

  // Only count incidents whose resolution actually follows detection; imported or replayed data can
  // otherwise carry timestamps that would make the average meaningless.
  const resolved = incidents.filter((i) => i.resolvedAt && i.resolvedAt.getTime() >= i.createdAt.getTime());
  const meanTimeToResolveMin = resolved.length
    ? Math.round(resolved.reduce((s, i) => s + (i.resolvedAt!.getTime() - i.createdAt.getTime()) / 60_000, 0) / resolved.length)
    : null;

  return {
    generatedAt: now.toISOString(),
    windowHours,
    anomalyRate: total ? Math.round((suspicious / total) * 1000) / 10 : 0,
    averageRiskScore,
    averageAnomalyScore,
    totalEvents: total,
    suspiciousEvents: suspicious,
    incidentsBySeverity,
    incidentsByStatus,
    eventsPerHour: bucketize(windowEvents, Math.min(windowHours, 48), now),
    topAttackTypes,
    suspiciousIps: [...ipAgg.entries()]
      .map(([sourceIp, v]) => ({ sourceIp, country: v.country, count: v.count, maxRisk: v.maxRisk, avgRisk: Math.round(v.sum / v.count) }))
      .sort((a, b) => b.maxRisk * 1000 + b.count - (a.maxRisk * 1000 + a.count))
      .slice(0, 10),
    affectedUsers: [...userAgg.entries()]
      .map(([user, v]) => ({ user, count: v.count, maxRisk: v.maxRisk, incidents: v.incidents.size }))
      .sort((a, b) => b.incidents * 1000 + b.maxRisk - (a.incidents * 1000 + a.maxRisk))
      .slice(0, 10),
    riskDistribution,
    meanTimeToResolveMin,
  };
}
