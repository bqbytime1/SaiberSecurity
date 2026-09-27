import "server-only";
import { exec } from "node:child_process";
import { hostname, platform } from "node:os";
import { promisify } from "node:util";
import type { RawSecurityEvent } from "../types";
import { HOST_AGENT_SOURCE } from "../types";

/**
 * Real network telemetry from the machine this server runs on.
 *
 * This reads the operating system's own connection table and DNS resolver cache. It is
 * genuinely observed activity, not generated: every remote address, port and process
 * name below came from the host. It is **not** packet capture, so there are no payloads
 * and no byte counts, and it only sees this machine's traffic rather than a whole
 * network. Capturing a network segment would need a span port and a pcap library.
 *
 * Nothing here executes attacker-controlled input: the commands are fixed strings and
 * all parsing happens on their output.
 */

const run = promisify(exec);
const COMMAND_TIMEOUT_MS = 15_000;

export interface Connection {
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  pid: number | null;
  process: string | null;
}

export interface DnsEntry {
  name: string;
  address: string;
}

export interface HostSample {
  takenAt: Date;
  host: string;
  connections: Connection[];
  dns: DnsEntry[];
  /** Populated when the sample could not be taken; the caller decides how loud to be. */
  error?: string;
}

function isLoopback(addr: string): boolean {
  return addr === "::1" || addr === "0.0.0.0" || addr === "::" || addr.startsWith("127.");
}

/** RFC1918, link-local, CGNAT and IPv6 unique-local / link-local. */
export function isPrivateAddress(addr: string): boolean {
  if (isLoopback(addr)) return true;
  if (addr.startsWith("10.") || addr.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return true;
  if (addr.startsWith("169.254.")) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr)) return true;
  const lower = addr.toLowerCase();
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

async function powershell(script: string): Promise<string> {
  const { stdout } = await run(`powershell.exe -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function parseJsonArray<T>(raw: string): T[] {
  const text = raw.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function sampleWindows(): Promise<{ connections: Connection[]; dns: DnsEntry[] }> {
  // One call returns connections already joined to their owning process name, so we
  // avoid a Get-Process round trip per row.
  const connScript = [
    "$p = @{};",
    "Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $p[$_.Id] = $_.ProcessName };",
    "Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |",
    "Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess,",
    "@{n='ProcessName';e={$p[[int]$_.OwningProcess]}} |",
    "ConvertTo-Json -Compress -Depth 3",
  ].join(" ");

  const dnsScript = [
    "Get-DnsClientCache -ErrorAction SilentlyContinue |",
    "Where-Object { $_.Type -eq 1 -or $_.Type -eq 28 } |",
    "Select-Object Entry, Data | ConvertTo-Json -Compress -Depth 3",
  ].join(" ");

  const [connRaw, dnsRaw] = await Promise.all([powershell(connScript), powershell(dnsScript).catch(() => "")]);

  type RawConn = { LocalAddress: string; LocalPort: number; RemoteAddress: string; RemotePort: number; OwningProcess: number; ProcessName?: string | null };
  const connections = parseJsonArray<RawConn>(connRaw).map((c) => ({
    localAddress: String(c.LocalAddress),
    localPort: Number(c.LocalPort),
    remoteAddress: String(c.RemoteAddress),
    remotePort: Number(c.RemotePort),
    pid: Number.isFinite(Number(c.OwningProcess)) ? Number(c.OwningProcess) : null,
    process: c.ProcessName ?? null,
  }));

  type RawDns = { Entry: string; Data: string };
  const dns = parseJsonArray<RawDns>(dnsRaw)
    .filter((d) => d && d.Entry && d.Data)
    .map((d) => ({ name: String(d.Entry).toLowerCase(), address: String(d.Data) }));

  return { connections, dns };
}

/** macOS and Linux: parse `netstat -n`. No process attribution without elevation. */
async function sampleUnix(): Promise<{ connections: Connection[]; dns: DnsEntry[] }> {
  let stdout: string;
  try {
    ({ stdout } = await run("netstat -n", { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }));
  } catch (err) {
    // Slim container images ship without net-tools, and the raw "command not found" that
    // surfaces on the Live page tells an operator nothing about how to fix it.
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|ENOENT/i.test(message)) {
      throw new Error("netstat is not installed on this host, so the connection table cannot be read. Install net-tools (Debian/Ubuntu: apt-get install net-tools).");
    }
    throw err;
  }
  const connections: Connection[] = [];

  for (const line of stdout.split("\n")) {
    if (!/ESTABLISHED/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = splitHostPort(parts[3]);
    const remote = splitHostPort(parts[4]);
    if (!local || !remote) continue;
    connections.push({
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      pid: null,
      process: null,
    });
  }
  return { connections, dns: [] };
}

/**
 * Split an address/port pair, in any of the four shapes netstat produces:
 *
 *   [::1]:443                  bracketed — port follows the bracket
 *   172.17.0.5:41234           Linux IPv4 — port follows the last colon
 *   2600:1f18:aaaa::5:52100    Linux IPv6 — unbracketed, port still follows the last colon
 *   192.168.1.20.51234         macOS — port follows the last dot, IPv6 included
 *                              (2600:1f18::5.51234)
 *
 * The separator is a dot only when one appears after the final colon, which is what
 * distinguishes the macOS form from an unbracketed IPv6 address. Treating every
 * multi-colon value as unparseable, as this did before, discarded each IPv6
 * connection on Linux and macOS without a trace.
 */
function splitHostPort(value: string): { address: string; port: number } | null {
  const bracket = value.lastIndexOf("]");
  const lastColon = value.lastIndexOf(":");
  const lastDot = value.lastIndexOf(".");
  let idx: number;
  if (bracket >= 0) {
    idx = value.indexOf(":", bracket);
  } else if (lastColon >= 0 && lastDot < lastColon) {
    idx = lastColon;
  } else {
    idx = lastDot;
  }
  if (idx <= 0) return null;
  const address = value.slice(0, idx).replace(/^\[|\]$/g, "");
  const port = Number(value.slice(idx + 1));
  if (!Number.isFinite(port) || port <= 0) return null;
  return { address, port };
}

/** Take one point-in-time sample of the host's network state. Never throws. */
export async function sampleHost(): Promise<HostSample> {
  const takenAt = new Date();
  const host = hostname();
  try {
    const { connections, dns } = platform() === "win32" ? await sampleWindows() : await sampleUnix();
    return { takenAt, host, connections, dns };
  } catch (err) {
    return { takenAt, host, connections: [], dns: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Ports whose traffic is unremarkable, used to keep routine browsing scored low. */
const COMMON_PORTS = new Set([80, 443, 53, 22, 123, 993, 995, 587, 465, 143, 110, 3478, 5228, 8080, 8443]);

function connectionKey(c: Connection): string {
  return `${c.localPort}|${c.remoteAddress}|${c.remotePort}|${c.pid ?? "?"}`;
}

export interface MappedSample {
  events: RawSecurityEvent[];
  /** Keys of every connection in this sample, for the caller's dedupe window. */
  keys: string[];
  externalCount: number;
  totalCount: number;
}

/**
 * Turn a sample into events, skipping anything already reported.
 *
 * Loopback and private-range destinations are ignored: they are the machine talking to
 * itself or to the LAN, which would bury genuine egress in noise.
 */
export function mapSampleToEvents(sample: HostSample, alreadySeen: ReadonlySet<string>, user: string): MappedSample {
  const events: RawSecurityEvent[] = [];
  const keys: string[] = [];
  let externalCount = 0;

  // Reverse map so an address can be labelled with the name that resolved to it.
  const nameByAddress = new Map<string, string>();
  for (const d of sample.dns) if (!nameByAddress.has(d.address)) nameByAddress.set(d.address, d.name);

  for (const c of sample.connections) {
    const key = connectionKey(c);
    keys.push(key);

    if (isPrivateAddress(c.remoteAddress)) continue;
    externalCount++;
    if (alreadySeen.has(key)) continue;

    const resolved = nameByAddress.get(c.remoteAddress) ?? null;
    events.push({
      timestamp: sample.takenAt,
      source: HOST_AGENT_SOURCE,
      eventType: "network_connection",
      user,
      sourceIp: c.localAddress,
      destinationIp: c.remoteAddress,
      country: null,
      device: sample.host,
      action: `net.connect.${c.remotePort}`,
      status: "established",
      metadata: {
        remotePort: c.remotePort,
        localPort: c.localPort,
        process: c.process ?? "unknown",
        pid: c.pid ?? 0,
        resolvedHost: resolved ?? "",
        commonPort: COMMON_PORTS.has(c.remotePort),
        collector: "host-network",
      },
    });
  }

  return { events, keys, externalCount, totalCount: sample.connections.length };
}

export function isHostMonitorSupported(): boolean {
  return platform() === "win32" || platform() === "linux" || platform() === "darwin";
}
