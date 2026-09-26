import "server-only";

/**
 * Outbound email.
 *
 * Delivery goes through any HTTP mail API that accepts a JSON body with from / to /
 * subject / text, which covers Resend, Postmark and most others. With nothing
 * configured the message is written to the server log instead, so password reset can
 * be exercised locally without a mail account. That fallback is refused in production:
 * silently swallowing a reset email there would strand real users.
 */

const TIMEOUT_MS = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  delivered: boolean;
  provider: "http" | "none";
  /** Present only outside production when no provider is configured. */
  preview?: string;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.MAIL_API_URL && process.env.MAIL_API_KEY && process.env.MAIL_FROM);
}

/**
 * Whether the log-and-show fallback may stand in for real delivery.
 *
 * Off in production by default, because returning a reset link in the response would
 * hand any caller a way into any account. The personal localhost build opts in
 * explicitly, since it runs with NODE_ENV=production but is bound to loopback and has
 * no mail account.
 */
export function isMailFallbackAllowed(): boolean {
  if (process.env.MAIL_DEV_FALLBACK === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/** True when password reset can be offered at all: real mail, or the local fallback. */
export function isPasswordResetAvailable(): boolean {
  return isMailConfigured() || isMailFallbackAllowed();
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const url = process.env.MAIL_API_URL;
  const key = process.env.MAIL_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!url || !key || !from) {
    if (!isMailFallbackAllowed()) {
      throw new Error("No mail provider configured");
    }
    console.warn(`[mail] No provider configured. Message for ${message.to}:\n${message.text}`);
    return { delivered: false, provider: "none", preview: message.text };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Mail provider responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { delivered: true, provider: "http" };
  } finally {
    clearTimeout(timer);
  }
}
