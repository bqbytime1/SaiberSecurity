import type { EventType, RawSecurityEvent } from "./types";

/**
 * Deterministic pseudo-random generator (mulberry32) so seeded datasets are
 * reproducible while live simulation can use a time-based seed.
 */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof createRng>;

export interface Persona {
  user: string;
  homeCountry: string;
  homeIp: string;
  device: string;
  role: string;
  activeHours: [number, number];
}

export const PERSONAS: Persona[] = [
  { user: "alice.chen", homeCountry: "US", homeIp: "10.20.4.15", device: "MBP-ALICE-01", role: "engineer", activeHours: [13, 23] },
  { user: "marcus.reed", homeCountry: "US", homeIp: "10.20.4.22", device: "WIN-MREED-07", role: "finance", activeHours: [13, 22] },
  { user: "priya.sharma", homeCountry: "IN", homeIp: "10.30.8.41", device: "MBP-PSHARMA", role: "engineer", activeHours: [3, 13] },
  { user: "james.okafor", homeCountry: "GB", homeIp: "10.40.2.9", device: "WIN-JOKAFOR", role: "sales", activeHours: [8, 18] },
  { user: "sofia.martinez", homeCountry: "ES", homeIp: "10.40.2.31", device: "MBP-SMARTINEZ", role: "marketing", activeHours: [7, 17] },
  { user: "liam.walsh", homeCountry: "IE", homeIp: "10.40.2.44", device: "WIN-LWALSH", role: "support", activeHours: [8, 18] },
  { user: "emma.johansson", homeCountry: "SE", homeIp: "10.40.3.12", device: "MBP-EJOHANSSON", role: "hr", activeHours: [7, 16] },
  { user: "noah.kim", homeCountry: "KR", homeIp: "10.30.9.5", device: "WIN-NKIM", role: "engineer", activeHours: [0, 10] },
  { user: "olivia.brown", homeCountry: "US", homeIp: "10.20.5.8", device: "MBP-OBROWN", role: "admin", activeHours: [13, 23] },
  { user: "daniel.silva", homeCountry: "BR", homeIp: "10.50.1.19", device: "WIN-DSILVA", role: "engineer", activeHours: [11, 21] },
  { user: "svc-backup", homeCountry: "US", homeIp: "10.10.0.12", device: "SRV-BACKUP-01", role: "service", activeHours: [0, 23] },
  { user: "svc-ci-runner", homeCountry: "US", homeIp: "10.10.0.30", device: "SRV-CI-03", role: "service", activeHours: [0, 23] },
];

export const EXTERNAL_IPS = {
  attacker: ["185.220.101.34", "45.155.205.233", "91.240.118.172", "194.26.29.101", "103.75.190.88"],
  travel: ["81.2.69.142", "203.0.113.55", "198.51.100.23", "31.13.72.36"],
};

const COUNTRY_FOR_IP: Record<string, string> = {
  "185.220.101.34": "RU",
  "45.155.205.233": "NL",
  "91.240.118.172": "RU",
  "194.26.29.101": "CN",
  "103.75.190.88": "VN",
  "81.2.69.142": "GB",
  "203.0.113.55": "AU",
  "198.51.100.23": "US",
  "31.13.72.36": "DE",
};

const INTERNAL_HOSTS = ["10.0.1.10", "10.0.1.11", "10.0.2.20", "10.0.2.21", "10.0.3.5", "10.0.3.6", "10.0.4.100"];
const RESOURCES = ["reports/q3-forecast.xlsx", "engineering/design-docs", "customer-db (read replica)", "sharepoint/marketing", "wiki/onboarding", "s3://corp-backups/daily", "jira-export.csv", "crm/contacts"];
const API_ENDPOINTS = ["/v1/users", "/v1/customers/export", "/v1/orders", "/v1/reports", "/v1/auth/token", "/v1/admin/keys"];
const BENIGN_DOMAINS = ["github.com", "slack.com", "office365.com", "google.com", "atlassian.net", "npmjs.org", "cloudflare.com"];
const CONFIG_SETTINGS = ["firewall.rule.allow-outbound-8443", "mfa.required=true", "backup.schedule=daily", "logging.retention=90d", "sso.session-timeout=8h"];

function jitter(rng: Rng, base: Date, minutes: number) {
  return new Date(base.getTime() + rng.int(-minutes * 60_000, minutes * 60_000));
}

function randomBenignBytes(rng: Rng) {
  // log-normal-ish: most downloads 1–40MB, occasional 100MB
  const mb = Math.exp(rng.next() * 3.7) * (rng.chance(0.08) ? 5 : 1);
  return Math.round(mb * 1_048_576);
}

function ev(
  partial: Partial<RawSecurityEvent> & Pick<RawSecurityEvent, "timestamp" | "eventType" | "sourceIp" | "action">,
): RawSecurityEvent {
  return {
    source: partial.source ?? "okta-sso",
    status: partial.status ?? "success",
    user: partial.user ?? null,
    destinationIp: partial.destinationIp ?? null,
    country: partial.country ?? null,
    device: partial.device ?? null,
    metadata: partial.metadata ?? null,
    ...partial,
  };
}

/** A single normal event for a persona at a specific time. */
export function benignEvent(rng: Rng, p: Persona, at: Date): RawSecurityEvent {
  const roll = rng.next();
  const common = { user: p.user, sourceIp: p.homeIp, country: p.homeCountry, device: p.device };
  if (roll < 0.42)
    return ev({ ...common, timestamp: at, eventType: "successful_login", source: rng.pick(["okta-sso", "vpn-gateway", "m365-audit"]), action: "user.session.start", status: "success", metadata: { userAgent: "Chrome/128" } });
  if (roll < 0.5)
    return ev({ ...common, timestamp: at, eventType: "failed_login", source: "okta-sso", action: "user.session.start", status: "failed", metadata: { reason: "invalid_password" } });
  if (roll < 0.68)
    return ev({ ...common, timestamp: at, eventType: "data_download", source: "file-server", destinationIp: rng.pick(INTERNAL_HOSTS), action: "file.download", status: "success", metadata: { bytes: randomBenignBytes(rng), resource: rng.pick(RESOURCES) } });
  if (roll < 0.82)
    return ev({ ...common, timestamp: at, eventType: "unusual_api_request", source: "api-gateway", destinationIp: "10.0.4.100", action: "api.request", status: "success", metadata: { requestCount: rng.int(20, 180), endpoint: rng.pick(API_ENDPOINTS.slice(0, 4)) } });
  if (roll < 0.92)
    return ev({ ...common, timestamp: at, eventType: "unusual_dns", source: "dns-resolver", action: "dns.query", status: "resolved", metadata: { domain: rng.pick(BENIGN_DOMAINS), requestCount: rng.int(1, 30) } });
  if (roll < 0.97)
    return ev({ ...common, timestamp: at, eventType: "configuration_change", source: rng.pick(["aws-cloudtrail", "m365-audit"]), action: "config.update", status: "success", metadata: { setting: rng.pick(CONFIG_SETTINGS.slice(2)) } });
  return ev({ ...common, timestamp: at, eventType: "successful_login", source: "vpn-gateway", action: "vpn.connect", status: "success" });
}

export type ScenarioName =
  | "repeated_failed_logins"
  | "credential_stuffing"
  | "impossible_travel"
  | "unusual_location_login"
  | "abnormal_api_volume"
  | "abnormal_data_transfer"
  | "privilege_escalation"
  | "port_scan"
  | "suspicious_process"
  | "malware_detected"
  | "unauthorized_access";

export const SCENARIOS: ScenarioName[] = [
  "repeated_failed_logins",
  "credential_stuffing",
  "impossible_travel",
  "unusual_location_login",
  "abnormal_api_volume",
  "abnormal_data_transfer",
  "privilege_escalation",
  "port_scan",
  "suspicious_process",
  "malware_detected",
  "unauthorized_access",
];

/** Generate the events that make up a named attack scenario, anchored at `at`. */
export function scenarioEvents(rng: Rng, name: ScenarioName, at: Date, personas: Persona[] = PERSONAS, pinnedTarget?: Persona, pinnedAttackerIp?: string): RawSecurityEvent[] {
  const target = pinnedTarget ?? rng.pick(personas.filter((p) => p.role !== "service"));
  const attackerIp = pinnedAttackerIp ?? rng.pick(EXTERNAL_IPS.attacker);
  const attackerCountry = COUNTRY_FOR_IP[attackerIp] ?? "RU";
  const out: RawSecurityEvent[] = [];

  switch (name) {
    case "repeated_failed_logins": {
      const n = rng.int(12, 26);
      for (let i = 0; i < n; i++) {
        out.push(ev({ timestamp: new Date(at.getTime() + i * rng.int(4_000, 25_000)), eventType: "failed_login", source: "okta-sso", user: target.user, sourceIp: attackerIp, country: attackerCountry, action: "user.session.start", status: "failed", metadata: { reason: "invalid_password", userAgent: "python-requests/2.31" } }));
      }
      break;
    }
    case "credential_stuffing": {
      const victims = [...personas].sort(() => rng.next() - 0.5).slice(0, 7);
      const n = rng.int(24, 40);
      for (let i = 0; i < n; i++) {
        const v = victims[i % victims.length];
        out.push(ev({ timestamp: new Date(at.getTime() + i * rng.int(1_500, 9_000)), eventType: "credential_attack", source: "okta-sso", user: v.user, sourceIp: attackerIp, country: attackerCountry, action: "user.session.start", status: "failed", metadata: { reason: "invalid_credentials", userAgent: "Mozilla/5.0 (compatible; bot)" } }));
      }
      break;
    }
    case "impossible_travel": {
      const farIp = rng.pick(EXTERNAL_IPS.travel.filter((ip) => COUNTRY_FOR_IP[ip] !== target.homeCountry));
      out.push(ev({ timestamp: new Date(at.getTime() - rng.int(30, 70) * 60_000), eventType: "successful_login", source: "okta-sso", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "user.session.start", status: "success" }));
      out.push(ev({ timestamp: at, eventType: "impossible_travel", source: "okta-sso", user: target.user, sourceIp: farIp, country: COUNTRY_FOR_IP[farIp], device: "Unknown-Device", action: "user.session.start", status: "success", metadata: { distanceKm: rng.int(6_000, 11_000), minutesSincePrevious: rng.int(30, 70), previousCountry: target.homeCountry, userAgent: "Firefox/129" } }));
      break;
    }
    case "unusual_location_login": {
      const ip = rng.pick(EXTERNAL_IPS.travel.filter((ip) => COUNTRY_FOR_IP[ip] !== target.homeCountry));
      out.push(ev({ timestamp: at, eventType: "successful_login", source: "vpn-gateway", user: target.user, sourceIp: ip, country: COUNTRY_FOR_IP[ip], device: "Unknown-Device", action: "vpn.connect", status: "success", metadata: { userAgent: "OpenVPN/2.6" } }));
      break;
    }
    case "abnormal_api_volume": {
      for (let i = 0; i < 3; i++) {
        out.push(ev({ timestamp: new Date(at.getTime() + i * 120_000), eventType: "unusual_api_request", source: "api-gateway", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, destinationIp: "10.0.4.100", action: "api.request", status: "success", metadata: { requestCount: rng.int(2_500, 6_000), endpoint: "/v1/customers/export" } }));
      }
      break;
    }
    case "abnormal_data_transfer": {
      out.push(ev({ timestamp: at, eventType: "data_download", source: "file-server", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, destinationIp: rng.pick(INTERNAL_HOSTS), action: "file.download", status: "success", metadata: { bytes: rng.int(2_500, 6_000) * 1_048_576, resource: "customer-db (full export)" } }));
      out.push(ev({ timestamp: new Date(at.getTime() + 180_000), eventType: "data_download", source: "aws-cloudtrail", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "s3.GetObject", status: "success", metadata: { bytes: rng.int(1_200, 3_000) * 1_048_576, resource: "s3://corp-backups/daily" } }));
      break;
    }
    case "privilege_escalation": {
      out.push(ev({ timestamp: new Date(at.getTime() - 10 * 60_000), eventType: "successful_login", source: "okta-sso", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "user.session.start", status: "success" }));
      out.push(ev({ timestamp: at, eventType: "privilege_escalation", source: "aws-cloudtrail", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "iam.AttachUserPolicy", status: "success", metadata: { role: "AdministratorAccess", previousRole: target.role, resource: "iam/user/" + target.user } }));
      out.push(ev({ timestamp: new Date(at.getTime() + 6 * 60_000), eventType: "configuration_change", source: "aws-cloudtrail", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "ec2.AuthorizeSecurityGroupIngress", status: "success", metadata: { setting: "sg-prod-db: allow 0.0.0.0/0:5432", resource: "prod-database" } }));
      break;
    }
    case "port_scan": {
      const bursts = rng.int(3, 6);
      for (let i = 0; i < bursts; i++) {
        out.push(ev({ timestamp: new Date(at.getTime() + i * rng.int(40_000, 120_000)), eventType: "port_scan", source: "corp-firewall", sourceIp: attackerIp, country: attackerCountry, destinationIp: rng.pick(INTERNAL_HOSTS), action: "net.scan", status: "blocked", metadata: { portCount: rng.int(120, 1_000), ports: [22, 80, 443, 3389, 5432, 8080] } }));
      }
      break;
    }
    case "suspicious_process": {
      out.push(ev({ timestamp: at, eventType: "suspicious_process", source: "crowdstrike-edr", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "process.create", status: "detected", metadata: { process: "powershell.exe", commandLine: "powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA..." } }));
      if (rng.chance(0.5))
        out.push(ev({ timestamp: new Date(at.getTime() + 90_000), eventType: "suspicious_process", source: "crowdstrike-edr", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "process.create", status: "detected", metadata: { process: "rundll32.exe", commandLine: "rundll32.exe C:\\Users\\Public\\comsvcs.dll, MiniDump 712 lsass.dmp full" } }));
      break;
    }
    case "malware_detected": {
      out.push(ev({ timestamp: at, eventType: "malware_detected", source: "crowdstrike-edr", user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "malware.detect", status: rng.chance(0.7) ? "quarantined" : "detected", metadata: { signature: rng.pick(["Trojan.Emotet", "Ransom.LockBit", "Backdoor.CobaltStrike", "HackTool.Mimikatz"]), file: rng.pick(["C:\\Users\\Public\\invoice.pdf.exe", "/tmp/.x/update.sh", "C:\\Temp\\svchost32.exe"]) } }));
      break;
    }
    case "unauthorized_access": {
      for (let i = 0; i < rng.int(2, 4); i++) {
        out.push(ev({ timestamp: new Date(at.getTime() + i * 60_000), eventType: "unauthorized_access", source: rng.pick(["m365-audit", "aws-cloudtrail"]), user: target.user, sourceIp: target.homeIp, country: target.homeCountry, device: target.device, action: "resource.access", status: rng.chance(0.6) ? "denied" : "success", metadata: { resource: rng.pick(["finance/payroll-2026.xlsx", "hr/compensation-bands", "s3://prod-secrets/", "admin-console"]) } }));
      }
      break;
    }
  }
  return out;
}

export interface GenerateOptions {
  rng: Rng;
  now: Date;
  /** Hours of history to generate */
  hours: number;
  /** Average normal events per persona per active hour */
  eventsPerPersonaHour: number;
  scenarios: Array<{ name: ScenarioName; at: Date; target?: Persona; attackerIp?: string }>;
}

/** Build a full dataset of mostly-normal activity with the requested scenarios injected. */
export function generateDataset(opts: GenerateOptions): RawSecurityEvent[] {
  const { rng, now, hours, eventsPerPersonaHour, scenarios } = opts;
  const events: RawSecurityEvent[] = [];
  const start = now.getTime() - hours * 3_600_000;

  for (const p of PERSONAS) {
    for (let h = 0; h < hours; h++) {
      const hourStart = new Date(start + h * 3_600_000);
      const utcHour = hourStart.getUTCHours();
      const [from, to] = p.activeHours;
      const active = from <= to ? utcHour >= from && utcHour <= to : utcHour >= from || utcHour <= to;
      const weekend = [0, 6].includes(hourStart.getUTCDay()) && p.role !== "service";
      const rate = active ? eventsPerPersonaHour * (weekend ? 0.15 : 1) : eventsPerPersonaHour * 0.04;
      const count = Math.round(rate * (0.5 + rng.next()));
      for (let i = 0; i < count; i++) events.push(benignEvent(rng, p, jitter(rng, new Date(hourStart.getTime() + 1_800_000), 30)));
    }
  }
  for (const s of scenarios) events.push(...scenarioEvents(rng, s.name, s.at, PERSONAS, s.target, s.attackerIp));

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return events.filter((e) => e.timestamp.getTime() <= now.getTime());
}

/** A small burst for the "Simulate New Events" button: mostly benign with an occasional scenario. */
export function generateLiveBurst(rng: Rng, now: Date, forceScenario?: ScenarioName): RawSecurityEvent[] {
  const events: RawSecurityEvent[] = [];
  const n = rng.int(14, 26);
  for (let i = 0; i < n; i++) {
    const p = rng.pick(PERSONAS);
    events.push(benignEvent(rng, p, new Date(now.getTime() - rng.int(0, 10 * 60_000))));
  }
  const scenario = forceScenario ?? (rng.chance(0.55) ? rng.pick(SCENARIOS) : null);
  if (scenario) events.push(...scenarioEvents(rng, scenario, new Date(now.getTime() - rng.int(60_000, 6 * 60_000))));
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return events.filter((e) => e.timestamp.getTime() <= now.getTime());
}

export const ALL_EVENT_TYPES: EventType[] = [
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
];
