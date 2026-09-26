export const EVENT_TYPES = [
  "failed_login",
  "successful_login",
  "impossible_travel",
  "privilege_escalation",
  "suspicious_process",
  "unusual_api_request",
  "data_download",
  "port_scan",
  "credential_attack",
  "malware_detected",
  "unusual_dns",
  "unauthorized_access",
  "configuration_change",
  // Emitted by the host collector for observed outbound connections. Its base weight
  // is deliberately near zero: ordinary browsing must not look like an attack.
  "network_connection",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Marks events produced by a real collector rather than the synthetic generator. */
export const HOST_AGENT_SOURCE = "host-agent";

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const THREAT_LEVELS = ["NORMAL", "ELEVATED", "HIGH", "CRITICAL"] as const;
export type ThreatLevel = (typeof THREAT_LEVELS)[number];

export const SENSITIVITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const INCIDENT_CATEGORIES = [
  "credential_attack",
  "impossible_travel",
  "unusual_login",
  "data_exfiltration",
  "privilege_escalation",
  "port_scan",
  "malware",
  "suspicious_process",
  "unauthorized_access",
  "unusual_api",
  "unusual_dns",
  "configuration_change",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export interface ScoreFactor {
  label: string;
  points: number;
  detail?: string;
}

export interface ScoreResult {
  anomalyScore: number;
  riskScore: number;
  severity: Severity;
  factors: ScoreFactor[];
}

export interface EventMetadata {
  bytes?: number;
  resource?: string;
  role?: string;
  previousRole?: string;
  process?: string;
  commandLine?: string;
  requestCount?: number;
  endpoint?: string;
  ports?: number[];
  portCount?: number;
  domain?: string;
  signature?: string;
  file?: string;
  setting?: string;
  reason?: string;
  userAgent?: string;
  distanceKm?: number;
  minutesSincePrevious?: number;
  previousCountry?: string;
  [key: string]: unknown;
}

export interface RawSecurityEvent {
  timestamp: Date;
  source: string;
  eventType: EventType;
  user?: string | null;
  sourceIp: string;
  destinationIp?: string | null;
  country?: string | null;
  device?: string | null;
  action: string;
  status: string;
  metadata?: EventMetadata | null;
}

export interface AiAnalysis {
  summary: string;
  whySuspicious: string;
  evidence: string[];
  riskAssessment: string;
  potentialImpact: string;
  recommendedActions: string[];
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  failed_login: "Failed Login",
  successful_login: "Successful Login",
  impossible_travel: "Impossible Travel",
  privilege_escalation: "Privilege Escalation",
  suspicious_process: "Suspicious Process",
  unusual_api_request: "Unusual API Request",
  data_download: "Data Download",
  port_scan: "Port Scan",
  credential_attack: "Credential Attack",
  malware_detected: "Malware Detected",
  unusual_dns: "Unusual DNS",
  unauthorized_access: "Unauthorized Access",
  configuration_change: "Configuration Change",
  network_connection: "Network Connection",
};

/** Compact variants used on chart axes, where a long label wraps and collides with its neighbours. */
export const EVENT_TYPE_SHORT_LABELS: Record<EventType, string> = {
  failed_login: "Failed Login",
  successful_login: "Successful Login",
  impossible_travel: "Impossible Travel",
  privilege_escalation: "Priv Escalation",
  suspicious_process: "Susp. Process",
  unusual_api_request: "Unusual API",
  data_download: "Data Download",
  port_scan: "Port Scan",
  credential_attack: "Credential Attack",
  malware_detected: "Malware Detected",
  unusual_dns: "Unusual DNS",
  unauthorized_access: "Unauth. Access",
  configuration_change: "Config Change",
  network_connection: "Network Conn.",
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  RESOLVED: "Resolved",
  FALSE_POSITIVE: "False Positive",
};

export function severityFromScore(score: number): Severity {
  if (score >= 80) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

export const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
