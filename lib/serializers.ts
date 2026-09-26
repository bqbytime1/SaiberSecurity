import type { Incident, SecurityEvent } from "@prisma/client";
import type { AiAnalysis, EventType, IncidentStatus, ScoreFactor, Severity } from "./types";
import { safeJsonParse } from "./utils";

export interface EventDTO {
  id: string;
  timestamp: string;
  source: string;
  eventType: EventType;
  user: string | null;
  sourceIp: string;
  destinationIp: string | null;
  country: string | null;
  device: string | null;
  action: string;
  status: string;
  metadata: Record<string, unknown>;
  anomalyScore: number;
  riskScore: number;
  severity: Severity;
  scoreFactors: ScoreFactor[];
  incidentId: string | null;
  createdAt: string;
}

export interface IncidentDTO {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  riskScore: number;
  status: IncidentStatus;
  category: string;
  eventCount: number;
  affectedUser: string | null;
  primaryIp: string | null;
  detectionReasons: string[];
  aiExplanation: AiAnalysis | null;
  recommendedActions: string[];
  aiProvider: "local" | "remote";
  firstEventAt: string;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export function serializeEvent(e: SecurityEvent): EventDTO {
  return {
    id: e.id,
    timestamp: e.timestamp.toISOString(),
    source: e.source,
    eventType: e.eventType as EventType,
    user: e.user,
    sourceIp: e.sourceIp,
    destinationIp: e.destinationIp,
    country: e.country,
    device: e.device,
    action: e.action,
    status: e.status,
    metadata: safeJsonParse<Record<string, unknown>>(e.metadata, {}),
    anomalyScore: e.anomalyScore,
    riskScore: e.riskScore,
    severity: e.severity as Severity,
    scoreFactors: safeJsonParse<ScoreFactor[]>(e.scoreFactors, []),
    incidentId: e.incidentId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeIncident(i: Incident): IncidentDTO {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity as Severity,
    riskScore: i.riskScore,
    status: i.status as IncidentStatus,
    category: i.category,
    eventCount: i.eventCount,
    affectedUser: i.affectedUser,
    primaryIp: i.primaryIp,
    detectionReasons: safeJsonParse<string[]>(i.detectionReasons, []),
    aiExplanation: safeJsonParse<AiAnalysis | null>(i.aiExplanation, null),
    recommendedActions: safeJsonParse<string[]>(i.recommendedActions, []),
    aiProvider: i.aiProvider === "remote" ? "remote" : "local",
    firstEventAt: i.firstEventAt.toISOString(),
    lastEventAt: i.lastEventAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
  };
}
