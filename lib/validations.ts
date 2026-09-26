import { z } from "zod";
import { EVENT_TYPES, INCIDENT_STATUSES, SENSITIVITIES, SEVERITIES } from "./types";
import { SCENARIOS } from "./synthetic";

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ipv6 = /^[0-9a-fA-F:]+$/;
export const ipSchema = z.string().min(1).max(45).refine((v) => ipv4.test(v) || (v.includes(":") && ipv6.test(v)), "Invalid IP address");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

/**
 * Weak passwords that a length rule alone would let through. Kept short on purpose:
 * a real deployment should check against a breach corpus instead.
 */
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssword", "p@ssw0rd",
  "12345678", "123456789", "1234567890", "qwertyui", "qwertyuiop", "letmein1", "letmein123",
  "iloveyou", "iloveyou1", "admin123", "admin12345", "welcome1", "welcome123", "changeme",
  "changeme123", "security123", "saibersecurity", "abcd1234", "abc12345", "administrator",
  "trustno1", "baseball", "football", "superman", "sunshine", "princess", "dragon123",
]);

export const PASSWORD_MIN_LENGTH = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, "Password must be at most 200 characters")
  .refine((v) => !WEAK_PASSWORDS.has(v.toLowerCase()), "That password is too common — choose something less guessable")
  .refine((v) => !/^(.)\1+$/.test(v), "Password cannot be a single repeated character");

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
    password: passwordSchema,
  })
  .refine((v) => !v.password.toLowerCase().includes(v.email.split("@")[0].toLowerCase()), {
    message: "Password must not contain your email name",
    path: ["password"],
  });

const phoneField = z.string().trim().min(6, "Enter a phone number").max(24);

export const phoneStartSchema = z.object({
  phone: phoneField,
  name: z.string().trim().min(1).max(80).optional(),
});

export const monitorActionSchema = z.object({
  action: z.enum(["start", "stop", "poll"]),
});

export const clearDataSchema = z.object({
  scope: z.enum(["simulated", "all"]),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, "That reset link is not valid").max(200),
    password: passwordSchema,
    confirm: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export const phoneVerifySchema = z.object({
  phone: phoneField,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  name: z.string().trim().min(1).max(80).optional(),
});

/**
 * Payload accepted from clients on POST /api/events.
 * Scores, severity and factors are intentionally NOT accepted — they are always
 * computed server-side.
 */
export const createEventSchema = z.object({
  timestamp: z.coerce.date().optional(),
  source: z.string().trim().min(1).max(64),
  eventType: z.enum(EVENT_TYPES),
  user: z.string().trim().min(1).max(128).nullable().optional(),
  sourceIp: ipSchema,
  destinationIp: ipSchema.nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  device: z.string().trim().min(1).max(128).nullable().optional(),
  action: z.string().trim().min(1).max(128),
  status: z.string().trim().min(1).max(32),
  metadata: z.record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.number()).max(64)])).optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const createEventsBodySchema = z.union([createEventSchema, z.object({ events: z.array(createEventSchema).min(1).max(500) })]);

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

export const eventsQuerySchema = z.object({
  ...pagination,
  severity: z.enum(SEVERITIES).optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  user: z.string().trim().max(128).optional(),
  sourceIp: z.string().trim().max(45).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minRisk: z.coerce.number().int().min(0).max(100).optional(),
  incidentId: z.string().max(64).optional(),
  search: z.string().trim().max(128).optional(),
  sort: z.enum(["timestamp", "riskScore"]).default("timestamp"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

export const incidentsQuerySchema = z.object({
  ...pagination,
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  search: z.string().trim().max(128).optional(),
});
export type IncidentsQuery = z.infer<typeof incidentsQuerySchema>;

export const updateIncidentSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No updatable fields provided");

export const simulateSchema = z.object({
  scenario: z.enum(SCENARIOS as [string, ...string[]]).optional(),
  bursts: z.coerce.number().int().min(1).max(5).default(1),
});

export const analyzeSchema = z.object({
  incidentId: z.string().min(1).max(64),
});

export const settingsSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(80).optional(),
    detectionSensitivity: z.enum(SENSITIVITIES).optional(),
    autoSimulate: z.boolean().optional(),
    autoSimulateInterval: z.coerce.number().int().min(30).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No updatable fields provided");

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}
