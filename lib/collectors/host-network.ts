import "server-only";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
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

/**
 * Linux: read the connection table straight out of `/proc/net/tcp` and `tcp6`.
 *
 * The kernel exposes the same table netstat prints, so reading it directly removes the
 * dependency on net-tools — which slim container images do not ship, and which made the
 * collector fail every poll on a deployed host. It also spawns no process at all.
 *
 * Addresses are hex and little-endian per 32-bit word: `0100007F:1F90` is 127.0.0.1:8080.
 */
async function sampleLinuxProc(): Promise<{ connections: Connection[]; dns: DnsEntry[] }> {
  const connections: Connection[] = [];

  for (const [file, width] of [
    ["/proc/net/tcp", 8],
    ["/proc/net/tcp6", 32],
  ] as const) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // tcp6 is absent on a host with IPv6 disabled; that is not an error.
    }
    connections.push(...parseProcNetTcp(text, width));
  }

  return { connections, dns: [] };
}

/**
 * Pure parser for one `/proc/net/tcp` table, split out from the file read so it can be
 * exercised against captured kernel output. `width` is the hex length of an address:
 * 8 for the IPv4 table, 32 for the IPv6 one.
 */
export function parseProcNetTcp(text: string, width: number): Connection[] {
  const ESTABLISHED = "01";
  const out: Connection[] = [];

  // The first line is the column header.
  for (const line of text.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || parts[3] !== ESTABLISHED) continue;
    const local = parseProcAddress(parts[1], width);
    const remote = parseProcAddress(parts[2], width);
    if (!local || !remote) continue;
    out.push({
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      // The table gives an inode, not a pid; mapping it back means walking every
      // /proc/*/fd, which needs root for other users' processes. Not worth it here.
      pid: null,
      process: null,
    });
  }

  return out;
}

/** `0100007F:1F90` -> 127.0.0.1 port 8080. `width` is the hex length of the address. */
function parseProcAddress(value: string, width: number): { address: string; port: number } | null {
  const sep = value.lastIndexOf(":");
  if (sep <= 0) return null;
  const hex = value.slice(0, sep);
  const port = Number.parseInt(value.slice(sep + 1), 16);
  if (hex.length !== width || !Number.isFinite(port) || port <= 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  // Each 8-hex-char word is byte-reversed, so undo that a word at a time.
  const bytes: number[] = [];
  for (let w = 0; w < hex.length; w += 8) {
    const word = hex.slice(w, w + 8);
    for (let b = 4; b > 0; b--) bytes.push(Number.parseInt(word.slice((b - 1) * 2, b * 2), 16));
  }

  if (bytes.length === 4) return { address: bytes.join("."), port };

  // An IPv4-mapped address (::ffff:a.b.c.d) is really an IPv4 connection; report it as one
  // so scoring and the UI do not treat the same peer as two different hosts.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return { address: bytes.slice(12).join("."), port };
  }

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return { address: compressIpv6(groups), port };
}

/** Collapse the longest run of zero groups to `::`, as RFC 5952 requires. */
function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === "0") {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const len = i - start;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
      start = -1;
    }
  }
  if (bestLen < 2) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

/** macOS: parse `netstat -n`. No process attribution without elevation. */
async function sampleUnix(): Promise<{ connections: Connection[]; dns: DnsEntry[] }> {
  const { stdout } = await run("netstat -n", { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
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
    const os = platform();
    const { connections, dns } = os === "win32" ? await sampleWindows() : os === "linux" ? await sampleLinuxProc() : await sampleUnix();
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
