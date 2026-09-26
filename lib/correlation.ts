import type { Incident, SecurityEvent } from "@prisma/client";
import { prisma } from "./prisma";
import { analyzeIncident, type AnalysisEvent } from "./ai";
import { SUSPICIOUS_THRESHOLD } from "./anomaly";
import {
  SEVERITY_RANK,
  severityFromScore,
  type EventMetadata,
  type EventType,
  type IncidentCategory,
  type ScoreFactor,
  type Severity,
} from "./types";
import { safeJsonParse } from "./utils";

/** Events attach to an existing open incident if it saw related activity within this many minutes. */
const CORRELATION_WINDOW_MIN = 90;

const DATA_DOWNLOAD_THRESHOLD_BYTES = 400 * 1_048_576;

export interface CorrelationResult {
  incident: Incident | null;
  created: boolean;
}

/** Decide which incident category (if any) a scored event belongs to. */
export function categoryForEvent(event: { eventType: string; anomalyScore: number; metadata: string | null; status: string }, factors: ScoreFactor[]): IncidentCategory | null {
  if (event.anomalyScore < SUSPICIOUS_THRESHOLD) return null;
  const type = event.eventType as EventType;
  const labels = new Set(factors.map((f) => f.label));
  const meta = safeJsonParse<EventMetadata>(event.metadata, {});

  switch (type) {
    case "failed_login":
    case "credential_attack":
      return "credential_attack";
    case "impossible_travel":
      return "impossible_travel";
    case "successful_login":
      if (labels.has("Impossible travel")) return "impossible_travel";
      if (labels.has("Success following repeated failures")) return "credential_attack";
      return "unusual_login";
    case "data_download":
      return typeof meta.bytes === "number" && meta.bytes >= DATA_DOWNLOAD_THRESHOLD_BYTES ? "data_exfiltration" : null;
    case "privilege_escalation":
      return "privilege_escalation";
    case "port_scan":
      return "port_scan";
    case "malware_detected":
      return "malware";
    case "suspicious_process":
      return "suspicious_process";
    case "unauthorized_access":
      return "unauthorized_access";
    case "unusual_api_request":
      return "unusual_api";
    case "unusual_dns":
      return "unusual_dns";
    case "configuration_change":
      // Follows a privilege escalation → fold into that incident instead
      if (labels.has("Follows recent privilege escalation")) return "privilege_escalation";
      return "configuration_change";
    default:
      return null;
  }
}

/** The entity an incident category is keyed on. */
function correlationKey(category: IncidentCategory, event: { user: string | null; sourceIp: string; device: string | null }): string {
  switch (category) {
    case "credential_attack":
    case "port_scan":
      return `${category}:ip:${event.sourceIp}`;
    case "malware":
    case "suspicious_process":
    case "unusual_dns":
      return `${category}:device:${event.device ?? event.sourceIp}`;
    default:
      return `${category}:user:${event.user ?? event.sourceIp}`;
  }
}

function titleFor(category: IncidentCategory, events: SecurityEvent[]): string {
  const distinctUsers = new Set(events.map((e) => e.user).filter(Boolean)).size;
  switch (category) {
    case "credential_attack":
      return distinctUsers >= 3 ? "Credential Stuffing Attempt" : "Repeated Failed Logins";
    case "impossible_travel":
      return "Impossible Travel Login";
    case "unusual_login":
      return "Login From Unusual Location";
    case "data_exfiltration":
      return "Unusual Data Transfer";
    case "privilege_escalation":
      return "Suspicious Privilege Escalation";
    case "port_scan":
      return "Port Scan Detected";
    case "malware":
      return "Malware Detected";
    case "suspicious_process":
      return "Suspicious Process Execution";
    case "unauthorized_access":
      return "Unauthorized Access Attempts";
    case "unusual_api":
      return "Abnormal API Request Volume";
    case "unusual_dns":
      return "Unusual DNS Activity";
    case "configuration_change":
      return "Suspicious Configuration Change";
  }
}

function descriptionFor(category: IncidentCategory, events: SecurityEvent[], affectedUser: string | null, primaryIp: string | null): string {
  const n = events.length;
  const users = new Set(events.map((e) => e.user).filter(Boolean)).size;
  switch (category) {
    case "credential_attack":
      return `${n} failed authentication attempt${n === 1 ? "" : "s"} from ${primaryIp} against ${users} account${users === 1 ? "" : "s"}.`;
    case "impossible_travel":
      return `${affectedUser} authenticated from two locations too far apart to travel between in the elapsed time.`;
    case "unusual_login":
      return `${affectedUser} signed in from a location or device outside their behavioural baseline.`;
    case "data_exfiltration":
      return `${affectedUser} transferred an abnormally large volume of data relative to their baseline.`;
    case "privilege_escalation":
      return `${affectedUser} obtained elevated privileges${n > 1 ? " followed by sensitive configuration activity" : ""}.`;
    case "port_scan":
      return `${primaryIp} probed internal hosts across a wide range of ports in ${n} burst${n === 1 ? "" : "s"}.`;
    case "malware":
      return `Endpoint protection flagged a known-malicious signature on a device used by ${affectedUser}.`;
    case "suspicious_process":
      return `Obfuscated or unusual process execution detected on a device used by ${affectedUser}.`;
    case "unauthorized_access":
      return `${affectedUser} made ${n} attempt${n === 1 ? "" : "s"} to access resources outside their entitlements.`;
    case "unusual_api":
      return `${affectedUser} issued API requests at many times their normal rate.`;
    case "unusual_dns":
      return `High-entropy DNS queries observed from a device used by ${affectedUser}.`;
    case "configuration_change":
      return `${affectedUser} changed security-relevant configuration outside normal patterns.`;
  }
}

/** Aggregate incident risk: the peak event risk, plus a small bonus for volume, capped at 100. */
function aggregateRisk(events: SecurityEvent[]): { riskScore: number; severity: Severity } {
  const peak = Math.max(...events.map((e) => e.riskScore));
  const volumeBonus = Math.min(5, Math.floor(Math.log2(Math.max(1, events.length))));
  const riskScore = Math.min(100, peak + volumeBonus);
  return { riskScore, severity: severityFromScore(riskScore) };
}

function detectionReasons(events: SecurityEvent[]): string[] {
  const totals = new Map<string, number>();
  for (const e of events) {
    for (const f of safeJsonParse<ScoreFactor[]>(e.scoreFactors, [])) {
      if (f.points <= 0 || f.label.startsWith("Base weight")) continue;
      totals.set(f.label, (totals.get(f.label) ?? 0) + f.points);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const typeCounts = new Map<string, number>();
  for (const e of events) typeCounts.set(e.eventType, (typeCounts.get(e.eventType) ?? 0) + 1);
  const typeSummary = [...typeCounts.entries()].map(([t, c]) => `${c}× ${t.replace(/_/g, " ")}`).join(", ");
  return [`Correlated ${events.length} event${events.length === 1 ? "" : "s"}: ${typeSummary}`, ...sorted.map(([label]) => label)];
}

function toAnalysisEvent(e: SecurityEvent): AnalysisEvent {
  return {
    timestamp: e.timestamp,
    eventType: e.eventType as EventType,
    user: e.user,
    sourceIp: e.sourceIp,
    destinationIp: e.destinationIp,
    country: e.country,
    device: e.device,
    action: e.action,
    status: e.status,
    riskScore: e.riskScore,
    factors: safeJsonParse<ScoreFactor[]>(e.scoreFactors, []),
    metadata: safeJsonParse<Record<string, unknown>>(e.metadata, {}),
  };
}

function primaryEntity(events: SecurityEvent[]) {
  const count = (vals: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return { affectedUser: count(events.map((e) => e.user)), primaryIp: count(events.map((e) => e.sourceIp)) };
}

/**
 * Attach a newly scored event to an existing open incident with the same
 * correlation key inside the time window, or open a new incident.
 */
export async function correlateEvent(event: SecurityEvent, factors: ScoreFactor[]): Promise<CorrelationResult> {
  const category = categoryForEvent(event, factors);
  if (!category) return { incident: null, created: false };

  const key = correlationKey(category, event);
  const windowStart = new Date(event.timestamp.getTime() - CORRELATION_WINDOW_MIN * 60_000);
  const windowEnd = new Date(event.timestamp.getTime() + CORRELATION_WINDOW_MIN * 60_000);

  const existing = await prisma.incident.findFirst({
    where: {
      correlationKey: key,
      status: { in: ["OPEN", "INVESTIGATING"] },
      lastEventAt: { gte: windowStart },
      firstEventAt: { lte: windowEnd },
    },
    orderBy: { lastEventAt: "desc" },
  });

  if (existing) {
    await prisma.securityEvent.update({ where: { id: event.id }, data: { incidentId: existing.id } });
    const events = await prisma.securityEvent.findMany({ where: { incidentId: existing.id }, orderBy: { timestamp: "asc" } });
    const { riskScore, severity } = aggregateRisk(events);
    const { affectedUser, primaryIp } = primaryEntity(events);
    const reasons = detectionReasons(events);
    const shouldRefreshAnalysis = existing.aiProvider === "local" || events.length % 10 === 0;

    let analysisPatch: { aiExplanation?: string; recommendedActions?: string; aiProvider?: string } = {};
    if (shouldRefreshAnalysis) {
      const { analysis, provider } = await analyzeIncident({
        title: existing.title,
        category,
        severity,
        riskScore,
        affectedUser,
        primaryIp,
        detectionReasons: reasons,
        events: events.map(toAnalysisEvent),
      });
      analysisPatch = {
        aiExplanation: JSON.stringify(analysis),
        recommendedActions: JSON.stringify(analysis.recommendedActions),
        aiProvider: provider,
      };
    }

    const incident = await prisma.incident.update({
      where: { id: existing.id },
      data: {
        title: titleFor(category, events),
        description: descriptionFor(category, events, affectedUser, primaryIp),
        riskScore,
        severity: SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity as Severity] ? severity : existing.severity,
        eventCount: events.length,
        affectedUser,
        primaryIp,
        detectionReasons: JSON.stringify(reasons),
        lastEventAt: events[events.length - 1].timestamp,
        firstEventAt: events[0].timestamp,
        ...analysisPatch,
      },
    });
    return { incident, created: false };
  }

  const events = [event];
  const { riskScore, severity } = aggregateRisk(events);
  const { affectedUser, primaryIp } = primaryEntity(events);
  const reasons = detectionReasons(events);
  const title = titleFor(category, events);
  const { analysis, provider } = await analyzeIncident({
    title,
    category,
    severity,
    riskScore,
    affectedUser,
    primaryIp,
    detectionReasons: reasons,
    events: events.map(toAnalysisEvent),
  });

  const incident = await prisma.incident.create({
    data: {
      title,
      description: descriptionFor(category, events, affectedUser, primaryIp),
      severity,
      riskScore,
      status: "OPEN",
      category,
      correlationKey: key,
      eventCount: 1,
      affectedUser,
      primaryIp,
      detectionReasons: JSON.stringify(reasons),
      aiExplanation: JSON.stringify(analysis),
      recommendedActions: JSON.stringify(analysis.recommendedActions),
      aiProvider: provider,
      firstEventAt: event.timestamp,
      lastEventAt: event.timestamp,
      // Detection time tracks the event that opened the incident rather than the row insert time,
      // so backfilled or replayed telemetry produces a coherent timeline (and a sane time-to-resolve).
      createdAt: event.timestamp,
      events: { connect: { id: event.id } },
    },
  });
  return { incident, created: true };
}

/** Re-run AI analysis for an incident (used by POST /api/ai/analyze). */
export async function reanalyzeIncident(incidentId: string): Promise<Incident | null> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { events: { orderBy: { timestamp: "asc" } } } });
  if (!incident) return null;
  const reasons = safeJsonParse<string[]>(incident.detectionReasons, []);
  const { analysis, provider } = await analyzeIncident({
    title: incident.title,
    category: incident.category as IncidentCategory,
    severity: incident.severity as Severity,
    riskScore: incident.riskScore,
    affectedUser: incident.affectedUser,
    primaryIp: incident.primaryIp,
    detectionReasons: reasons,
    events: incident.events.map(toAnalysisEvent),
  });
  return prisma.incident.update({
    where: { id: incidentId },
    data: { aiExplanation: JSON.stringify(analysis), recommendedActions: JSON.stringify(analysis.recommendedActions), aiProvider: provider },
  });
}
