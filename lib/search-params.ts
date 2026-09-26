import type { ZodType } from "zod";

export type SearchParams = Record<string, string | string[] | undefined>;

/** Flatten Next.js searchParams and validate; invalid input falls back to schema defaults. */
export function parseSearchParams<T>(raw: SearchParams, schema: ZodType<T>): T {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== "" && value !== "all") flat[k] = value;
  }
  const result = schema.safeParse(flat);
  if (result.success) return result.data;
  const fallback = schema.safeParse({});
  if (fallback.success) return fallback.data;
  throw new Error("Search params schema has no defaults");
}
