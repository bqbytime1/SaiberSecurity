import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth 2.0 / OIDC sign-in.
 *
 * Every provider follows the same authorization-code flow with PKCE. Adding one is a
 * matter of appending an entry to PROVIDERS and supplying its two environment
 * variables; nothing else in the app needs to change.
 *
 * Secrets are read only here, on the server. A provider with no credentials is
 * reported as unconfigured and its button renders disabled rather than failing at
 * redirect time.
 */

export const OAUTH_PROVIDER_IDS = ["google", "microsoft", "github"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  /** Only a provider-verified email may be auto-linked to an existing account. */
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}

interface ProviderDefinition {
  id: OAuthProviderId;
  label: string;
  scope: string;
  authorizeUrl: () => string;
  tokenUrl: () => string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  /** Extra parameters appended to the authorization request. */
  authorizeParams?: Record<string, string>;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const FETCH_TIMEOUT_MS = 10_000;

async function httpJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new Error(`${url} responded ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS: Record<OAuthProviderId, ProviderDefinition> = {
  google: {
    id: "google",
    label: "Google",
    scope: "openid email profile",
    authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    clientId: () => process.env.GOOGLE_CLIENT_ID || undefined,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || undefined,
    authorizeParams: { access_type: "online", prompt: "select_account" },
    async fetchProfile(accessToken) {
      const p = await httpJson<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return {
        providerAccountId: p.sub,
        email: p.email?.toLowerCase() ?? null,
        emailVerified: p.email_verified === true,
        name: p.name ?? null,
        image: p.picture ?? null,
      };
    },
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    scope: "openid email profile User.Read",
    authorizeUrl: () => `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/authorize`,
    tokenUrl: () => `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/token`,
    clientId: () => process.env.MICROSOFT_CLIENT_ID || undefined,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET || undefined,
    async fetchProfile(accessToken) {
      const p = await httpJson<{ id: string; mail?: string | null; userPrincipalName?: string; displayName?: string }>(
        "https://graph.microsoft.com/v1.0/me",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const email = (p.mail ?? p.userPrincipalName ?? "").toLowerCase() || null;
      return {
        providerAccountId: p.id,
        email,
        // Entra ID only returns addresses that belong to the directory account.
        emailVerified: Boolean(email),
        name: p.displayName ?? null,
        image: null,
      };
    },
  },
  github: {
    id: "github",
    label: "GitHub",
    scope: "read:user user:email",
    authorizeUrl: () => "https://github.com/login/oauth/authorize",
    tokenUrl: () => "https://github.com/login/oauth/access_token",
    clientId: () => process.env.GITHUB_CLIENT_ID || undefined,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET || undefined,
    async fetchProfile(accessToken) {
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "SAiberSecurity" };
      const p = await httpJson<{ id: number; login: string; name?: string | null; avatar_url?: string }>("https://api.github.com/user", { headers });
      // The profile email is null when the user keeps it private, so ask for the
      // address list and take the verified primary.
      let email: string | null = null;
      let emailVerified = false;
      try {
        const emails = await httpJson<Array<{ email: string; primary: boolean; verified: boolean }>>("https://api.github.com/user/emails", { headers });
        const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
        if (chosen) {
          email = chosen.email.toLowerCase();
          emailVerified = true;
        }
      } catch {
        // Scope may have been declined; fall through with no email.
      }
      return {
        providerAccountId: String(p.id),
        email,
        emailVerified,
        name: p.name || p.login,
        image: p.avatar_url ?? null,
      };
    },
  },
};

export interface ProviderStatus {
  id: OAuthProviderId;
  label: string;
  configured: boolean;
}

/** Safe to hand to client components: contains no secrets. */
export function listOAuthProviders(): ProviderStatus[] {
  return OAUTH_PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id];
    return { id, label: p.label, configured: Boolean(p.clientId() && p.clientSecret()) };
  });
}

export function isProviderConfigured(id: OAuthProviderId): boolean {
  const p = PROVIDERS[id];
  return Boolean(p.clientId() && p.clientSecret());
}

/**
 * Callback URL registered with the provider. APP_URL wins so that deployments behind a
 * proxy produce the right value; otherwise the current request origin is used.
 */
export function redirectUri(id: OAuthProviderId, requestOrigin: string): string {
  const base = (process.env.APP_URL || requestOrigin).replace(/\/+$/, "");
  return `${base}/api/auth/oauth/${id}/callback`;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildAuthorizeUrl(id: OAuthProviderId, opts: { state: string; challenge: string; redirectUri: string }): string {
  const p = PROVIDERS[id];
  const url = new URL(p.authorizeUrl());
  url.searchParams.set("client_id", p.clientId()!);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(p.authorizeParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export async function exchangeCodeForProfile(
  id: OAuthProviderId,
  opts: { code: string; verifier: string; redirectUri: string },
): Promise<OAuthProfile> {
  const p = PROVIDERS[id];
  const body = new URLSearchParams({
    client_id: p.clientId()!,
    client_secret: p.clientSecret()!,
    code: opts.code,
    grant_type: "authorization_code",
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  });
  const token = await httpJson<{ access_token?: string; error?: string; error_description?: string }>(p.tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!token.access_token) {
    throw new Error(`token exchange failed: ${token.error_description ?? token.error ?? "no access_token"}`);
  }
  return p.fetchProfile(token.access_token);
}

export function providerLabel(id: OAuthProviderId): string {
  return PROVIDERS[id].label;
}
