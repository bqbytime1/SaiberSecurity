import {
  HOST_AGENT_SOURCE,
  type EventMetadata,
  type EventType,
  type RawSecurityEvent,
  type ScoreFactor,
  type ScoreResult,
  type Sensitivity,
  severityFromScore,
} from "./types";

/**
 * Historical context fetched from the database for the entity (user / IP)
 * involved in the event. Everything the scorer needs is precomputed here so
 * the scoring function itself stays pure and unit-testable.
 */
export interface EventContext {
  /** Failed-auth events (failed_login / credential_attack) from this IP, last 15 min */
  ipFailedAuthLast15m: number;
  /** Distinct usernames targeted by failed auth from this IP, last 15 min */
  ipDistinctUsersLast15m: number;
  /** Failed-auth events against this user (any IP), last 30 min */
  userFailedAuthLast30m: number;
  /** Total events from this IP in the last hour */
  ipEventsLastHour: number;
  /** Most common country for this user over the baseline window (null if unknown) */
  userHomeCountry: string | null;
  /** Number of distinct countries the user has been seen from in the baseline window */
  userCountryCount: number;
  /** Previous authenticated location for this user, for travel analysis */
  userPreviousLocation: { country: string; timestamp: Date } | null;
  /** Mean bytes of prior data_download events by this user (null if no baseline) */
  userMeanDownloadBytes: number | null;
  /** Std deviation of prior data_download bytes by this user */
  userStdDownloadBytes: number | null;
  /** Mean requestCount for prior unusual_api_request / API-style events by this user */
  userMeanApiRequests: number | null;
  /** Did this user have a privilege_escalation in the last 60 minutes? */
  userRecentPrivilegeEscalation: boolean;
  /** Did this user have a successful login within the last 60 min? */
  userRecentSuccessfulLogin: boolean;
  /** Was this IP involved in an event with anomalyScore >= 55 between 24h and 1h ago (i.e. a returning source, not the current burst)? */
  ipPreviouslyFlagged: boolean;
  /** Hours (0-23) in which the user is typically active, from their baseline */
  userActiveHours: number[];
  /** Number of port_scan events from this IP in the last 15 minutes */
  ipPortScanLast15m: number;
  /** Number of events from this IP in the last hour that were already scored >= 30 */
  ipSuspiciousLastHour: number;
}

export const EMPTY_CONTEXT: EventContext = {
  ipFailedAuthLast15m: 0,
  ipDistinctUsersLast15m: 0,
  userFailedAuthLast30m: 0,
  ipEventsLastHour: 0,
  userHomeCountry: null,
  userCountryCount: 0,
  userPreviousLocation: null,
  userMeanDownloadBytes: null,
  userStdDownloadBytes: null,
  userMeanApiRequests: null,
  userRecentPrivilegeEscalation: false,
  userRecentSuccessfulLogin: false,
  ipPreviouslyFlagged: false,
  userActiveHours: [],
  ipPortScanLast15m: 0,
  ipSuspiciousLastHour: 0,
};

/** Prior weight for each event type before any behavioral analysis. */
const BASE_WEIGHT: Record<EventType, number> = {
  // Observed egress from the host collector. Near zero on purpose: a browser opening a
  // socket is the single most ordinary thing a machine does, and scoring it any higher
  // would drown the console in false positives the moment real monitoring is enabled.
  network_connection: 1,
  successful_login: 2,
  failed_login: 8,
  unusual_dns: 10,
  data_download: 10,
  unusual_api_request: 12,
  configuration_change: 18,
  credential_attack: 20,
  privilege_escalation: 28,
  port_scan: 30,
  suspicious_process: 38,
  unauthorized_access: 55,
  impossible_travel: 62,
  malware_detected: 72,
};

/** Ports that carry remote control, and so deserve attention leaving a workstation. */
const REMOTE_ADMIN_PORTS = new Set([22, 23, 135, 139, 445, 1433, 3306, 3389, 4444, 5432, 5900, 5985, 5986, 6379, 9001, 27017]);

/** Countries treated as higher-risk origins for this demo dataset. */
const ELEVATED_RISK_COUNTRIES = new Set(["RU", "KP", "IR", "CN", "NG", "BY"]);

/** Sensitive resource/role keywords that raise business risk. */
const SENSITIVE_KEYWORDS = ["admin", "prod", "production", "database", "db", "finance", "hr", "payroll", "customer", "secrets", "vault", "root", "domain", "backup"];

const SENSITIVITY_MULTIPLIER: Record<Sensitivity, number> = { LOW: 0.85, MEDIUM: 1, HIGH: 1.15 };

const AUTH_FAILURE_TYPES: ReadonlySet<EventType> = new Set(["failed_login", "credential_attack"]);

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function add(factors: ScoreFactor[], label: string, points: number, detail?: string) {
  if (points === 0) return;
  factors.push({ label, points: Math.round(points), detail });
}

function isSensitive(meta: EventMetadata | null | undefined, action: string) {
  const haystack = `${meta?.resource ?? ""} ${meta?.role ?? ""} ${meta?.setting ?? ""} ${action}`.toLowerCase();
  return SENSITIVE_KEYWORDS.some((k) => haystack.includes(k));
}

/** RFC1918 / loopback ranges — IP-reputation factors only make sense for external sources. */
export function isPrivateIp(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(ip);
}

/**
 * Deterministic, explainable anomaly scoring.
 *
 * anomalyScore  – how far this event deviates from expected behaviour (0–100)
 * riskScore     – anomaly adjusted for business impact of what was touched (0–100)
 * severity      – derived from riskScore
 * factors       – every contribution, so the UI can show "+25 Authentication frequency abnormal"
 */
export function scoreEvent(
  event: RawSecurityEvent,
  ctx: EventContext,
  sensitivity: Sensitivity = "MEDIUM",
): ScoreResult {
  const factors: ScoreFactor[] = [];
  const meta = event.metadata ?? {};
  const type = event.eventType;

  add(factors, `Base weight for ${type.replace(/_/g, " ")}`, BASE_WEIGHT[type]);

  // ── Frequency analysis: repeated authentication failures ────────────────
  if (AUTH_FAILURE_TYPES.has(type)) {
    const n = ctx.ipFailedAuthLast15m + 1;
    if (n >= 20) add(factors, "Authentication frequency abnormal", 32, `${n} failed attempts from ${event.sourceIp} in 15 min`);
    else if (n >= 10) add(factors, "Authentication frequency elevated", 22, `${n} failed attempts from ${event.sourceIp} in 15 min`);
    else if (n >= 5) add(factors, "Multiple failed attempts", 12, `${n} failed attempts from ${event.sourceIp} in 15 min`);
    else if (n >= 3) add(factors, "Repeated failed attempts", 6, `${n} failed attempts from ${event.sourceIp} in 15 min`);

    if (ctx.ipDistinctUsersLast15m >= 5)
      add(factors, "Credential stuffing pattern", 12, `${ctx.ipDistinctUsersLast15m} distinct accounts targeted from one IP`);
    else if (ctx.ipDistinctUsersLast15m >= 3)
      add(factors, "Multiple accounts targeted from one IP", 6, `${ctx.ipDistinctUsersLast15m} distinct accounts`);

    if (ctx.userFailedAuthLast30m >= 8)
      add(factors, "Account under sustained attack", 10, `${ctx.userFailedAuthLast30m} failures against ${event.user} in 30 min`);
  }

  // ── Login after a burst of failures (possible successful brute force) ────
  if (type === "successful_login" && ctx.ipFailedAuthLast15m >= 5) {
    add(factors, "Success following repeated failures", 35, `${ctx.ipFailedAuthLast15m} prior failures from ${event.sourceIp}`);
  }

  // ── Location analysis ───────────────────────────────────────────────────
  if (event.country) {
    if (ctx.userHomeCountry && event.country !== ctx.userHomeCountry) {
      const rare = ctx.userCountryCount <= 1;
      add(
        factors,
        rare ? "Login from unusual country" : "Country differs from baseline",
        rare ? 30 : 12,
        `${event.country} vs. baseline ${ctx.userHomeCountry}`,
      );
    }
    if (ELEVATED_RISK_COUNTRIES.has(event.country)) {
      add(factors, "Elevated-risk geography", 8, event.country);
    }
  }

  // ── Impossible travel (independent of the event type label) ─────────────
  if (ctx.userPreviousLocation && event.country && ctx.userPreviousLocation.country !== event.country) {
    const minutes = Math.abs(event.timestamp.getTime() - ctx.userPreviousLocation.timestamp.getTime()) / 60000;
    const isAuth = type === "successful_login" || type === "impossible_travel";
    if (isAuth && minutes < 120) {
      add(
        factors,
        "Impossible travel",
        type === "impossible_travel" ? 20 : 45,
        `${ctx.userPreviousLocation.country} → ${event.country} in ${Math.round(minutes)} min`,
      );
    }
  }
  if (type === "impossible_travel" && typeof meta.distanceKm === "number" && typeof meta.minutesSincePrevious === "number") {
    const speedKmh = meta.distanceKm / Math.max(meta.minutesSincePrevious / 60, 0.1);
    if (speedKmh > 1500) add(factors, "Physically impossible travel speed", 18, `~${Math.round(speedKmh)} km/h implied`);
  }

  // ── Time-of-day anomaly (describes the user's own behaviour, so skipped for attacker-driven auth failures) ──
  const hour = event.timestamp.getUTCHours();
  if (!AUTH_FAILURE_TYPES.has(type)) {
    if (ctx.userActiveHours.length >= 5 && !ctx.userActiveHours.includes(hour)) {
      add(factors, "Outside user's normal active hours", 10, `${String(hour).padStart(2, "0")}:00 UTC`);
    } else if (ctx.userActiveHours.length < 5 && (hour < 5 || hour >= 23)) {
      add(factors, "Off-hours activity", 6, `${String(hour).padStart(2, "0")}:00 UTC`);
    }
  }

  // ── Data transfer volume ────────────────────────────────────────────────
  if (type === "data_download" && typeof meta.bytes === "number") {
    const mb = meta.bytes / 1_048_576;
    if (mb >= 50 && ctx.userMeanDownloadBytes && ctx.userStdDownloadBytes && ctx.userStdDownloadBytes > 0) {
      const z = (meta.bytes - ctx.userMeanDownloadBytes) / ctx.userStdDownloadBytes;
      if (z >= 6) add(factors, "Extreme deviation from download baseline", 45, `${z.toFixed(1)}σ above user's mean`);
      else if (z >= 3) add(factors, "Large deviation from download baseline", 30, `${z.toFixed(1)}σ above user's mean`);
      else if (z >= 2) add(factors, "Download volume above baseline", 14, `${z.toFixed(1)}σ above user's mean`);
    } else if (mb >= 2000) add(factors, "Very large data transfer", 40, `${Math.round(mb)} MB`);
    else if (mb >= 500) add(factors, "Large data transfer", 25, `${Math.round(mb)} MB`);
    else if (mb >= 100) add(factors, "Above-average data transfer", 8, `${Math.round(mb)} MB`);
  }

  // ── API volume ──────────────────────────────────────────────────────────
  if (type === "unusual_api_request" && typeof meta.requestCount === "number") {
    const ratio = ctx.userMeanApiRequests ? meta.requestCount / ctx.userMeanApiRequests : meta.requestCount / 200;
    if (ratio >= 20) add(factors, "API request volume far above baseline", 45, `${meta.requestCount} requests (${ratio.toFixed(0)}× baseline)`);
    else if (ratio >= 10) add(factors, "API request volume far above baseline", 35, `${meta.requestCount} requests (${ratio.toFixed(0)}× baseline)`);
    else if (ratio >= 4) add(factors, "API request volume above baseline", 20, `${meta.requestCount} requests (${ratio.toFixed(1)}× baseline)`);
    else if (ratio >= 2) add(factors, "API request volume elevated", 6, `${meta.requestCount} requests`);
  }

  // ── Port scanning ───────────────────────────────────────────────────────
  if (type === "port_scan") {
    const ports = meta.portCount ?? meta.ports?.length ?? 0;
    if (ports >= 500) add(factors, "Wide port sweep", 24, `${ports} ports probed`);
    else if (ports >= 100) add(factors, "Broad port sweep", 16, `${ports} ports probed`);
    else if (ports >= 20) add(factors, "Multiple ports probed", 8, `${ports} ports probed`);
    if (ctx.ipPortScanLast15m >= 3) add(factors, "Sustained scanning from source", 8, `${ctx.ipPortScanLast15m + 1} scan bursts in 15 min`);
  }

  // ── Observed network egress (host collector) ────────────────────────────
  // Everything here is about the shape of the connection, not its mere existence.
  if (type === "network_connection") {
    const port = Number(meta.remotePort ?? 0);
    const proc = String(meta.process ?? "unknown");

    if (!meta.commonPort && port > 0) {
      if (REMOTE_ADMIN_PORTS.has(port)) add(factors, "Remote-administration port", 22, `port ${port} to ${event.destinationIp}`);
      else if (port < 1024) add(factors, "Uncommon privileged port", 10, `port ${port}`);
      else add(factors, "Uncommon destination port", 6, `port ${port}`);
    }
    if (/^(powershell|cmd|wscript|cscript|rundll32|regsvr32|mshta|certutil|bitsadmin)$/i.test(proc)) {
      add(factors, "Scripting host making outbound connection", 26, `${proc} connected to ${event.destinationIp}:${port}`);
    }
    if (!meta.resolvedHost && port !== 443 && port !== 80) {
      add(factors, "Destination has no matching DNS lookup", 5, "connection to a literal address");
    }
  }

  // ── Privilege changes ───────────────────────────────────────────────────
  if (type === "privilege_escalation") {
    if (meta.role && /admin|root|domain|owner/i.test(String(meta.role))) add(factors, "Elevation to high-privilege role", 12, String(meta.role));
    if (!ctx.userRecentSuccessfulLogin) add(factors, "No recent interactive login for this user", 8);
  }
  // Only compounds activity that is itself notable — a routine DNS lookup after an escalation is not evidence.
  const hasOwnSignal = factors.some((f) => f.points > 0 && !f.label.startsWith("Base weight"));
  if (ctx.userRecentPrivilegeEscalation && type !== "privilege_escalation" && (hasOwnSignal || BASE_WEIGHT[type] >= 18)) {
    add(factors, "Follows recent privilege escalation", 20, `${event.user} escalated privileges within the last hour`);
  }

  // ── Malware / process ───────────────────────────────────────────────────
  if (type === "malware_detected") {
    if (meta.signature && /ransom|trojan|backdoor|rat|cobalt|mimikatz/i.test(String(meta.signature)))
      add(factors, "High-impact malware family", 15, String(meta.signature));
    if (event.status === "quarantined" || event.status === "blocked") add(factors, "Threat contained by endpoint control", -12, event.status);
  }
  if (type === "suspicious_process") {
    const cmd = String(meta.commandLine ?? meta.process ?? "").toLowerCase();
    if (/powershell.*(-enc|-e |bypass|hidden)|mshta|regsvr32|certutil|rundll32|wscript/.test(cmd))
      add(factors, "Living-off-the-land technique", 22, "Encoded or obfuscated command execution");
    if (/mimikatz|lsass|procdump|sekurlsa/.test(cmd)) add(factors, "Credential dumping indicators", 30, "LSASS access pattern");
  }

  // ── DNS ─────────────────────────────────────────────────────────────────
  if (type === "unusual_dns" && meta.domain) {
    const d = String(meta.domain);
    const label = d.split(".")[0] ?? "";
    const entropy = shannonEntropy(label);
    if (label.length >= 25 && entropy > 3.5) add(factors, "High-entropy domain (possible DGA or tunneling)", 25, d);
    else if (label.length >= 15 && entropy > 3.2) add(factors, "Unusual domain structure", 12, d);
    if (typeof meta.requestCount === "number" && meta.requestCount >= 200) add(factors, "High DNS query volume", 10, `${meta.requestCount} queries`);
  }

  // ── Unauthorized access ─────────────────────────────────────────────────
  if (type === "unauthorized_access" && event.status === "denied") {
    add(factors, "Access attempt was denied by policy", -8, "Control held");
  }

  // ── Suspicious IP behaviour (cross-event, external sources only) ────────
  // Host-collector events are excluded: their sourceIp is the monitored machine
  // itself, so reputation and volume heuristics about "the source" say nothing, and
  // the collector's own steady stream of samples would otherwise make the machine
  // look like an abnormally noisy address to itself.
  if (event.source !== HOST_AGENT_SOURCE && !isPrivateIp(event.sourceIp)) {
    if (ctx.ipPreviouslyFlagged) add(factors, "Source IP previously flagged", 12, `${event.sourceIp} in the last 24h`);
    // Auth failures and port scans already carry their own frequency factors; avoid counting the same burst twice.
    if (ctx.ipSuspiciousLastHour >= 5 && !AUTH_FAILURE_TYPES.has(type) && type !== "port_scan")
      add(factors, "Suspicious source IP behaviour", 10, `${ctx.ipSuspiciousLastHour} suspicious events in the last hour`);
    if (ctx.ipEventsLastHour >= 200 && !AUTH_FAILURE_TYPES.has(type))
      add(factors, "Abnormal event volume from source", 8, `${ctx.ipEventsLastHour} events in the last hour`);
  }

  // ── Blocked / denied outcomes reduce the anomaly slightly ───────────────
  if (["blocked", "denied", "failed"].includes(event.status) && type === "unusual_api_request") {
    add(factors, "Request rejected by API gateway", -5);
  }

  const rawAnomaly = factors.reduce((s, f) => s + f.points, 0) * SENSITIVITY_MULTIPLIER[sensitivity];
  const anomalyScore = clamp(rawAnomaly);

  // ── Business-risk adjustment ────────────────────────────────────────────
  const riskFactors: ScoreFactor[] = [];
  if (isSensitive(meta, event.action) && anomalyScore >= 20) {
    add(riskFactors, "Sensitive resource involved", 10, meta.resource ?? meta.role ?? meta.setting ?? event.action);
  }
  const riskScore = clamp(anomalyScore + riskFactors.reduce((s, f) => s + f.points, 0));

  return {
    anomalyScore,
    riskScore,
    severity: severityFromScore(riskScore),
    factors: [...factors, ...riskFactors],
  };
}

function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Events at or above this anomaly score are considered suspicious and eligible for incident correlation. */
export const SUSPICIOUS_THRESHOLD = 30;
