import type { AiAnalysis, IncidentCategory, ScoreFactor, Severity } from "./types";
import { EVENT_TYPE_LABELS, type EventType } from "./types";
import { formatBytes } from "./utils";

export interface AnalysisEvent {
  timestamp: Date;
  eventType: EventType;
  user: string | null;
  sourceIp: string;
  destinationIp: string | null;
  country: string | null;
  device: string | null;
  action: string;
  status: string;
  riskScore: number;
  factors: ScoreFactor[];
  metadata: Record<string, unknown>;
}

export interface IncidentAnalysisInput {
  title: string;
  category: IncidentCategory;
  severity: Severity;
  riskScore: number;
  affectedUser: string | null;
  primaryIp: string | null;
  detectionReasons: string[];
  events: AnalysisEvent[];
}

export type AiProvider = "local" | "remote";

export interface AiProviderStatus {
  configured: boolean;
  provider: AiProvider;
  baseUrl: string | null;
  model: string | null;
}

export function getAiProviderStatus(): AiProviderStatus {
  const configured = Boolean(process.env.AI_API_KEY && process.env.AI_API_KEY.trim().length > 0);
  return {
    configured,
    provider: configured ? "remote" : "local",
    baseUrl: configured ? (process.env.AI_BASE_URL ?? "https://api.openai.com/v1") : null,
    model: configured ? (process.env.AI_MODEL ?? "gpt-4o-mini") : null,
  };
}

/**
 * Produce an incident analysis. Uses the configured OpenAI-compatible provider
 * when AI_API_KEY is set, otherwise (or on any provider failure) falls back to
 * the deterministic local engine. Never throws.
 */
export async function analyzeIncident(input: IncidentAnalysisInput): Promise<{ analysis: AiAnalysis; provider: AiProvider }> {
  const status = getAiProviderStatus();
  if (status.configured) {
    try {
      const remote = await analyzeWithRemoteProvider(input);
      if (remote) return { analysis: remote, provider: "remote" };
    } catch (err) {
      console.warn("[ai] remote provider failed, using local analysis:", err instanceof Error ? err.message : err);
    }
  }
  return { analysis: generateLocalAnalysis(input), provider: "local" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote provider (OpenAI-compatible chat completions)
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior security analyst at SaiberSecurity, an AI-native behavioral anomaly detection platform.
You explain security incidents to SOC analysts. Be precise, calm, and evidence-driven.
Never claim certainty the evidence does not support: use hedged language such as "likely", "potentially", "consistent with", "may indicate".
Distinguish clearly between what was observed and what it might mean.
Respond ONLY with a JSON object of this exact shape:
{"summary": string, "whySuspicious": string, "evidence": string[], "riskAssessment": string, "potentialImpact": string, "recommendedActions": string[]}
Keep each string under 600 characters. Provide 3-6 evidence items and 3-6 practical, defensive recommended actions.`;

async function analyzeWithRemoteProvider(input: IncidentAnalysisInput): Promise<AiAnalysis | null> {
  const baseUrl = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  const apiKey = process.env.AI_API_KEY!;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildEvidencePrompt(input) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`provider responded ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(stripCodeFence(content)) as Partial<AiAnalysis>;
    return normalizeAnalysis(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

function stripCodeFence(s: string) {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

function normalizeAnalysis(p: Partial<AiAnalysis>): AiAnalysis | null {
  const str = (v: unknown, max = 1200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 500)).filter(Boolean).slice(0, 8) : []);
  const out: AiAnalysis = {
    summary: str(p.summary),
    whySuspicious: str(p.whySuspicious),
    evidence: arr(p.evidence),
    riskAssessment: str(p.riskAssessment),
    potentialImpact: str(p.potentialImpact),
    recommendedActions: arr(p.recommendedActions),
  };
  if (!out.summary || out.recommendedActions.length === 0) return null;
  return out;
}

function buildEvidencePrompt(input: IncidentAnalysisInput): string {
  const lines = input.events.slice(0, 40).map((e) => {
    const meta = Object.entries(e.metadata)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    return `- ${e.timestamp.toISOString()} | ${e.eventType} | user=${e.user ?? "-"} | ip=${e.sourceIp} | country=${e.country ?? "-"} | status=${e.status} | risk=${e.riskScore} | ${meta}`;
  });
  return [
    `Incident: ${input.title}`,
    `Category: ${input.category}`,
    `Severity: ${input.severity} (risk score ${input.riskScore}/100)`,
    `Affected user: ${input.affectedUser ?? "n/a"}`,
    `Primary source IP: ${input.primaryIp ?? "n/a"}`,
    `Detection reasons (from the deterministic scoring engine):`,
    ...input.detectionReasons.map((r) => `  • ${r}`),
    `Events (${input.events.length} total, showing up to 40):`,
    ...lines,
    ``,
    `Produce the JSON analysis now.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic local analysis
// ─────────────────────────────────────────────────────────────────────────────

function fmtTime(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function describeSpan(events: AnalysisEvent[]) {
  if (events.length === 0) return "an unknown period";
  const first = events[0].timestamp.getTime();
  const last = events[events.length - 1].timestamp.getTime();
  const mins = Math.max(1, Math.round((last - first) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"}`;
}

export function generateLocalAnalysis(input: IncidentAnalysisInput): AiAnalysis {
  const events = [...input.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const users = uniq(events.map((e) => e.user).filter((u): u is string => Boolean(u)));
  const ips = uniq(events.map((e) => e.sourceIp));
  const countries = uniq(events.map((e) => e.country).filter((c): c is string => Boolean(c)));
  const devices = uniq(events.map((e) => e.device).filter((d): d is string => Boolean(d)));
  const span = describeSpan(events);
  const user = input.affectedUser ?? users[0] ?? "an unidentified account";
  const ip = input.primaryIp ?? ips[0] ?? "an unknown source";
  const maxRisk = Math.max(...events.map((e) => e.riskScore), 0);
  const first = events[0];
  const last = events[events.length - 1];
  const statuses = uniq(events.map((e) => e.status));
  const containedCount = events.filter((e) => ["blocked", "denied", "quarantined", "failed"].includes(e.status)).length;

  // Aggregate top scoring factors across the incident for "why suspicious"
  const factorTotals = new Map<string, { points: number; count: number; detail?: string }>();
  for (const e of events) {
    for (const f of e.factors) {
      if (f.points <= 0 || f.label.startsWith("Base weight")) continue;
      const cur = factorTotals.get(f.label) ?? { points: 0, count: 0, detail: f.detail };
      cur.points += f.points;
      cur.count += 1;
      if (!cur.detail && f.detail) cur.detail = f.detail;
      factorTotals.set(f.label, cur);
    }
  }
  const topFactors = [...factorTotals.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 5);

  const evidence: string[] = [];
  evidence.push(`${events.length} correlated event${events.length === 1 ? "" : "s"} observed over ${span} (${fmtTime(first.timestamp)} → ${fmtTime(last.timestamp)}).`);
  if (users.length) evidence.push(`Account${users.length > 1 ? "s" : ""} involved: ${users.slice(0, 6).join(", ")}${users.length > 6 ? ` and ${users.length - 6} more` : ""}.`);
  evidence.push(`Source IP${ips.length > 1 ? "s" : ""}: ${ips.slice(0, 4).join(", ")}${countries.length ? ` (${countries.join(", ")})` : ""}.`);
  if (devices.length) evidence.push(`Device${devices.length > 1 ? "s" : ""}: ${devices.slice(0, 4).join(", ")}.`);
  for (const [label, v] of topFactors.slice(0, 3)) {
    evidence.push(`${label}${v.detail ? ` — ${v.detail}` : ""}${v.count > 1 ? ` (seen on ${v.count} events)` : ""}.`);
  }
  evidence.push(`Highest single-event risk score: ${maxRisk}/100. Outcome statuses observed: ${statuses.join(", ")}.`);

  const cat = CATEGORY_TEXT[input.category];
  const summary = cat.summary({ user, ip, events, span, countries, users, ips });

  const whyLines = [cat.why];
  if (topFactors.length) {
    whyLines.push(
      `The scoring engine weighted this incident primarily on: ${topFactors
        .map(([label, v]) => `${label.toLowerCase()} (+${v.points})`)
        .join(", ")}.`,
    );
  }
  whyLines.push(
    "These signals are consistent with the pattern described, though legitimate explanations (misconfigured automation, a user travelling, a scheduled bulk job) are possible and should be ruled out.",
  );

  const containment =
    containedCount === events.length
      ? "All observed actions were blocked, denied, or quarantined by existing controls, which reduces immediate impact but does not rule out continued attempts."
      : containedCount > 0
        ? `${containedCount} of ${events.length} actions were blocked or denied; the remainder succeeded and warrant closer review.`
        : "No preventive control blocked the observed activity, so any malicious intent may have been partially or fully realised.";

  const riskAssessment = `${SEVERITY_TEXT[input.severity]} Aggregate risk score ${input.riskScore}/100. ${containment}`;

  return {
    summary,
    whySuspicious: whyLines.join(" "),
    evidence,
    riskAssessment,
    potentialImpact: cat.impact,
    recommendedActions: cat.actions({ user, ip }),
  };
}

const SEVERITY_TEXT: Record<Severity, string> = {
  CRITICAL: "Critical: the evidence strongly suggests active compromise or an attack that is likely to succeed without immediate intervention.",
  HIGH: "High: the activity is likely malicious or represents a serious control failure; prompt investigation is warranted.",
  MEDIUM: "Medium: the activity deviates from baseline and may indicate early-stage malicious behaviour or a policy violation.",
  LOW: "Low: the deviation is minor and is likely benign, but is recorded for context and trend analysis.",
};

interface SummaryCtx {
  user: string;
  ip: string;
  events: AnalysisEvent[];
  span: string;
  countries: string[];
  users: string[];
  ips: string[];
}

interface CategoryText {
  summary: (c: SummaryCtx) => string;
  why: string;
  impact: string;
  actions: (c: { user: string; ip: string }) => string[];
}

const CATEGORY_TEXT: Record<IncidentCategory, CategoryText> = {
  credential_attack: {
    summary: ({ ip, events, span, users, countries }) =>
      users.length > 2
        ? `${events.length} failed authentication attempts from ${ip}${countries.length ? ` (${countries.join(", ")})` : ""} targeted ${users.length} different accounts within ${span}. The volume and spread across accounts is consistent with a credential stuffing or password spraying campaign rather than a user mistyping a password.`
        : `${events.length} failed authentication attempts against ${users[0] ?? "a single account"} originated from ${ip}${countries.length ? ` (${countries.join(", ")})` : ""} within ${span}. The rate and persistence are consistent with an automated brute-force attempt.`,
    why: "Legitimate users rarely fail authentication more than a handful of times in quick succession, and almost never against multiple accounts from one address.",
    impact: "If any of the attempted credentials are valid, the attacker may gain an initial foothold, access mailboxes or SaaS data, and pivot to further systems. Even unsuccessful campaigns can lock out legitimate users.",
    actions: ({ ip, user }) => [
      `Block or rate-limit ${ip} at the identity provider and perimeter.`,
      `Verify that MFA is enforced for ${user} and any other targeted accounts.`,
      "Check whether any of the targeted accounts subsequently authenticated successfully from the same or nearby IPs.",
      "Search for the source IP in threat-intelligence feeds and prior logs for related activity.",
      "Consider a forced password reset for targeted accounts if credentials may have been exposed in a public breach.",
    ],
  },
  impossible_travel: {
    summary: ({ user, countries, events }) =>
      `${user} authenticated from ${countries.length >= 2 ? `${countries[0]} and then ${countries[countries.length - 1]}` : "two distant locations"} within a window too short for physical travel (${events.length} related event${events.length === 1 ? "" : "s"}). This is consistent with credential theft, session token replay, or an unrecognised VPN or proxy.`,
    why: "Two successful logins from geographically distant locations in a short interval cannot both be the same person at a keyboard unless a VPN, proxy, or shared credential is involved.",
    impact: "If the second session is attacker-controlled, they likely have the same access as the user — including email, documents, and any systems reachable via SSO — and may already be exfiltrating data or establishing persistence.",
    actions: ({ user }) => [
      `Contact ${user} out-of-band to confirm whether they are travelling or using a VPN.`,
      `Revoke all active sessions and refresh tokens for ${user} and require re-authentication with MFA.`,
      "Review the second session's activity for mailbox rules, file downloads, or OAuth consent grants.",
      "Check whether the unfamiliar device or user agent has been seen elsewhere in the organisation.",
      "If compromise is confirmed, rotate any credentials or API keys the user had access to.",
    ],
  },
  unusual_login: {
    summary: ({ user, ip, countries }) =>
      `${user} signed in from ${ip}${countries.length ? ` (${countries.join(", ")})` : ""}, a location and device not seen in their behavioural baseline. This may indicate travel or a new device, but is also consistent with use of stolen credentials.`,
    why: "The login deviates from the user's established country, device, and timing patterns; new-location logins are a common first signal of account takeover.",
    impact: "If the session is not the legitimate user, the attacker has whatever access the account holds and may attempt to escalate or persist.",
    actions: ({ user }) => [
      `Confirm the login with ${user} through a trusted channel.`,
      "Require step-up MFA for sessions originating from new countries or devices.",
      "Review the session's subsequent activity for unusual data access.",
      "If unrecognised, terminate the session and reset the password.",
    ],
  },
  data_exfiltration: {
    summary: ({ user, events }) => {
      const bytes = events.reduce((s, e) => s + (typeof e.metadata.bytes === "number" ? e.metadata.bytes : 0), 0);
      const resources = uniq(events.map((e) => e.metadata.resource).filter((r): r is string => typeof r === "string"));
      return `${user} transferred approximately ${formatBytes(bytes)} across ${events.length} download event${events.length === 1 ? "" : "s"}${resources.length ? ` involving ${resources.slice(0, 2).join(" and ")}` : ""}, far above their historical baseline. This volume may indicate bulk data collection prior to exfiltration, though a legitimate migration or backup task is also possible.`;
    },
    why: "The transferred volume is a statistical outlier relative to the user's own history, and large exports of customer or backup data are a common precursor to data theft.",
    impact: "Potential loss of confidential or regulated data, with associated breach-notification, contractual, and reputational consequences.",
    actions: ({ user }) => [
      `Ask ${user} or their manager whether a bulk export was expected.`,
      "Identify the destination of the data (endpoint, cloud storage, removable media) via DLP or proxy logs.",
      "Temporarily restrict the account's access to the affected data stores pending review.",
      "Preserve logs and the endpoint for forensic review if intent cannot be established.",
      "Consider tightening export limits or requiring approval for large downloads of sensitive datasets.",
    ],
  },
  privilege_escalation: {
    summary: ({ user, events }) => {
      const role = events.map((e) => e.metadata.role).find((r): r is string => typeof r === "string");
      const followOn = events.filter((e) => e.eventType !== "privilege_escalation" && e.eventType !== "successful_login").length;
      return `${user} was granted elevated privileges${role ? ` (${role})` : ""}${followOn ? ` and performed ${followOn} additional sensitive action${followOn === 1 ? "" : "s"} shortly afterwards` : ""}. Unexpected privilege changes may indicate a compromised account or misuse, but could also reflect an unrecorded change request.`;
    },
    why: "Privilege escalation outside of a change window, especially when followed by configuration changes to production resources, matches the pattern of an attacker expanding their access.",
    impact: "An account with administrative rights can disable logging, create backdoor identities, expose production data, or alter security controls across the environment.",
    actions: ({ user }) => [
      `Verify the privilege change against change-management records and with ${user}'s manager.`,
      "Review all actions performed by the account since the escalation, particularly IAM and network changes.",
      "If unauthorised, revert the role assignment and any dependent configuration changes.",
      "Enable approval-gated, time-bound elevation (just-in-time access) for administrative roles.",
      "Audit who else can grant administrative roles and tighten that permission set.",
    ],
  },
  port_scan: {
    summary: ({ ip, events, countries }) => {
      const ports = events.reduce((s, e) => s + (typeof e.metadata.portCount === "number" ? e.metadata.portCount : 0), 0);
      const targets = uniq(events.map((e) => e.destinationIp).filter(Boolean));
      return `${ip}${countries.length ? ` (${countries.join(", ")})` : ""} probed roughly ${ports.toLocaleString()} ports across ${targets.length} internal host${targets.length === 1 ? "" : "s"} in ${events.length} scan burst${events.length === 1 ? "" : "s"}. This is consistent with reconnaissance ahead of an exploitation attempt.`;
    },
    why: "Sequential connection attempts across many ports from one external address have no legitimate business purpose and typically precede targeted exploitation.",
    impact: "Reconnaissance itself causes little harm, but it reveals exposed services; any unpatched or misconfigured service discovered may be attacked next.",
    actions: ({ ip }) => [
      `Block ${ip} at the perimeter and add it to the watch list.`,
      "Confirm that all probed services are patched and that only intended ports are exposed.",
      "Review firewall logs for any connections that were not blocked.",
      "Check whether the same source has scanned other organisational ranges.",
    ],
  },
  malware: {
    summary: ({ user, events }) => {
      const sig = events.map((e) => e.metadata.signature).find((s): s is string => typeof s === "string");
      const file = events.map((e) => e.metadata.file).find((s): s is string => typeof s === "string");
      const quarantined = events.every((e) => e.status === "quarantined");
      return `Endpoint protection detected ${sig ?? "malware"}${file ? ` in ${file}` : ""} on a device used by ${user}. ${quarantined ? "The file was quarantined, which likely prevented execution, but the delivery vector remains unexplained." : "The detection was not confirmed as quarantined, so the payload may have executed."}`;
    },
    why: "A known-malicious signature on a corporate endpoint is a direct indicator of an attempted or successful compromise.",
    impact: "Depending on the malware family: credential theft, lateral movement, ransomware encryption, or persistent remote access.",
    actions: ({ user }) => [
      "Isolate the affected endpoint from the network pending investigation.",
      "Confirm the quarantine action succeeded and capture a memory image if execution is suspected.",
      `Determine the delivery vector (email attachment, download, USB) and check whether other users received the same file.`,
      `Reset credentials for ${user} and any accounts used on the device.`,
      "Run a full scan on the endpoint and search for the same hash across the fleet.",
    ],
  },
  suspicious_process: {
    summary: ({ user, events }) => {
      const procs = uniq(events.map((e) => e.metadata.process).filter((p): p is string => typeof p === "string"));
      return `${procs.length ? procs.join(", ") : "A process"} launched with obfuscated or unusual arguments on a device used by ${user}. Encoded PowerShell and LSASS access patterns are consistent with living-off-the-land tradecraft, though some administrative tools produce similar telemetry.`;
    },
    why: "Attackers frequently abuse built-in system binaries with encoded commands to evade signature-based detection; such invocations are rare in normal user activity.",
    impact: "Potential credential theft, defence evasion, or the staging of further payloads on the endpoint.",
    actions: ({ user }) => [
      "Retrieve and decode the full command line to determine what was executed.",
      "Isolate the endpoint if credential access or download activity is confirmed.",
      `Review ${user}'s recent logins and any lateral movement from the device.`,
      "Enable PowerShell script-block logging and constrained language mode if not already active.",
    ],
  },
  unauthorized_access: {
    summary: ({ user, events }) => {
      const resources = uniq(events.map((e) => e.metadata.resource).filter((r): r is string => typeof r === "string"));
      const denied = events.filter((e) => e.status === "denied").length;
      return `${user} attempted to access ${resources.length ? resources.slice(0, 3).join(", ") : "restricted resources"} outside their normal entitlements (${denied} of ${events.length} attempts denied). Repeated attempts against sensitive resources may indicate probing for over-permissioned data.`;
    },
    why: "Access attempts to finance, HR, or secrets resources by a user without a business need are unusual and, when repeated, suggest deliberate probing.",
    impact: "Exposure of confidential personnel, financial, or infrastructure data if any attempt succeeded or permissions are later broadened.",
    actions: ({ user }) => [
      `Review ${user}'s role and whether the access attempts had a business justification.`,
      "Confirm that the denied attempts were correctly blocked and that no successful access to the same resources occurred.",
      "Audit permissions on the targeted resources for over-broad sharing.",
      "Consider alerting the resource owner and HR if the pattern persists.",
    ],
  },
  unusual_api: {
    summary: ({ user, events }) => {
      const total = events.reduce((s, e) => s + (typeof e.metadata.requestCount === "number" ? e.metadata.requestCount : 0), 0);
      const endpoint = events.map((e) => e.metadata.endpoint).find((s): s is string => typeof s === "string");
      return `${user} issued roughly ${total.toLocaleString()} API requests${endpoint ? ` to ${endpoint}` : ""} in a short window, many times their usual rate. This may indicate scripted enumeration or data scraping, or a legitimate but unannounced integration.`;
    },
    why: "Request volume far outside the user's baseline, particularly against export or enumeration endpoints, is a common signature of automated data harvesting.",
    impact: "Bulk extraction of customer or business records via the API, and potential service degradation.",
    actions: ({ user }) => [
      "Inspect the API gateway logs for the request pattern and response sizes.",
      `Confirm with ${user} whether a script or integration is responsible.`,
      "Apply per-token rate limits and scope the API key to the minimum required endpoints.",
      "Rotate the API credentials if the activity cannot be attributed.",
    ],
  },
  unusual_dns: {
    summary: ({ user, events }) => {
      const domains = uniq(events.map((e) => e.metadata.domain).filter((d): d is string => typeof d === "string"));
      return `A device used by ${user} resolved ${domains.length} unusual domain${domains.length === 1 ? "" : "s"} (${domains.slice(0, 2).join(", ")}) with high-entropy names. This pattern is consistent with domain-generation algorithms or DNS tunneling used by malware for command-and-control.`;
    },
    why: "Randomised, high-entropy hostnames are rarely typed by humans and are characteristic of malware beaconing.",
    impact: "An active command-and-control channel could allow remote control of the endpoint and covert data exfiltration.",
    actions: () => [
      "Sinkhole or block the domains at the resolver and check for other endpoints resolving them.",
      "Inspect the endpoint for the process generating the queries.",
      "Correlate with proxy and firewall logs for follow-on connections.",
      "Isolate the endpoint if beaconing continues.",
    ],
  },
  configuration_change: {
    summary: ({ user, events }) => {
      const setting = events.map((e) => e.metadata.setting).find((s): s is string => typeof s === "string");
      return `${user} modified security-relevant configuration${setting ? ` (${setting})` : ""} outside of normal patterns. Changes that widen network exposure or weaken authentication may be a mistake, an undocumented change, or deliberate weakening of controls.`;
    },
    why: "Configuration changes that reduce security posture, especially to production resources and without a change record, are a frequent step in both insider misuse and account compromise.",
    impact: "Increased attack surface; production data or services may be exposed to the internet or to unauthenticated access.",
    actions: ({ user }) => [
      "Compare the change with change-management records and confirm intent with the requester.",
      "Revert the change if it cannot be justified, and review dependent systems for exposure.",
      `Review ${user}'s other recent changes for the same pattern.`,
      "Add policy-as-code guardrails that block high-risk configuration changes automatically.",
    ],
  },
};

export function eventTypeLabel(t: string): string {
  return (EVENT_TYPE_LABELS as Record<string, string>)[t] ?? t;
}
