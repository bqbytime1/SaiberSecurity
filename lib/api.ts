import { NextResponse, type NextRequest } from "next/server";
import type { ZodError, ZodType } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";
import { rateLimit } from "./rate-limit";
import { formatZodError } from "./validations";

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

/**
 * The origin a visitor actually typed, for building links that leave the app.
 *
 * Behind a proxy such as Render's, the request the server sees arrives on an internal
 * address over plain HTTP, so `nextUrl.origin` would produce a reset link or OAuth
 * callback pointing somewhere nobody can reach. APP_URL wins when set; otherwise the
 * forwarded headers reconstruct the public origin.
 */
export function publicOrigin(req: NextRequest): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Render supplies its own public URL, so a deployment there is correct without APP_URL
  // being set by hand. One fewer value to get wrong.
  const render = process.env.RENDER_EXTERNAL_URL?.trim();
  if (render) return render.replace(/\/+$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.nextUrl.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

type AuthedHandler<Ctx> = (req: NextRequest, user: SessionUser, ctx: Ctx) => Promise<Response> | Response;

/** Wrap a route handler so it requires a valid session and never leaks stack traces. */
export function withAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return jsonError(401, "Authentication required");
      return await handler(req, user, ctx);
    } catch (err) {
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return jsonError(500, "Internal server error");
    }
  };
}

export function enforceRateLimit(req: NextRequest, bucket: string, limit: number, windowMs: number): Response | null {
  const res = rateLimit(`${bucket}:${getClientIp(req)}`, limit, windowMs);
  if (res.ok) return null;
  return NextResponse.json(
    { error: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": String(res.retryAfterSec) } },
  );
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): { data: T } | { error: Response } {
  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  const result = schema.safeParse(raw);
  if (!result.success) return { error: jsonError(400, formatZodError(result.error as ZodError)) };
  return { data: result.data };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<{ data: T } | { error: Response }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { error: jsonError(400, "Request body must be valid JSON") };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { error: jsonError(400, formatZodError(result.error as ZodError)) };
  return { data: result.data };
}
