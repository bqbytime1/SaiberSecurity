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
 * Whether a message may be echoed back to whoever triggered it.
 *
 * This is the dangerous one: a reset link in the HTTP response hands any caller a way
 * into any account, so it is off in production unless explicitly opted into. The
 * personal localhost build does opt in, because it runs with NODE_ENV=production but
 * is bound to loopback and has no mail account.
 */
export function isMailPreviewAllowed(): boolean {
  if (process.env.MAIL_DEV_FALLBACK === "true") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Whether messages may be written to the server log instead of being delivered.
 *
 * Safe on a public deployment in a way the preview is not: reading the log requires
 * access to the hosting dashboard, not merely the ability to submit a form. It lets a
 * single-operator deployment use password reset before any mail account exists.
 */
export function isMailLogTransportEnabled(): boolean {
  return process.env.MAIL_TRANSPORT === "log";
}

/** True when password reset can be offered at all. */
export function isPasswordResetAvailable(): boolean {
  return isMailConfigured() || isMailPreviewAllowed() || isMailLogTransportEnabled();
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const url = process.env.MAIL_API_URL;
  const key = process.env.MAIL_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!url || !key || !from) {
    const preview = isMailPreviewAllowed();
    if (!preview && !isMailLogTransportEnabled()) {
      throw new Error("No mail provider configured");
    }
    console.warn(
      `[mail] No provider configured; writing to the log instead.\n[mail] to: ${message.to}\n[mail] subject: ${message.subject}\n${message.text}`,
    );
    // The preview is returned only where echoing it back is safe.
    return { delivered: false, provider: "none", ...(preview ? { preview: message.text } : {}) };
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
