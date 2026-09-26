import type { Organization } from "@prisma/client";
import { prisma } from "./prisma";
import type { Sensitivity } from "./types";

/**
 * Settings belong to an organization, which is also the tenancy boundary for every
 * security event and incident. Each function therefore takes the organization it is
 * acting on: there is no ambient "current" one, so a caller cannot forget to say.
 */

export interface AppSettings {
  organizationName: string;
  detectionSensitivity: Sensitivity;
  autoSimulate: boolean;
  autoSimulateInterval: number;
  updatedAt: Date;
}

function toAppSettings(row: Organization): AppSettings {
  return {
    organizationName: row.name,
    detectionSensitivity: row.detectionSensitivity as Sensitivity,
    autoSimulate: row.autoSimulate,
    autoSimulateInterval: row.autoSimulateInterval,
    updatedAt: row.updatedAt,
  };
}

export async function getSettings(organizationId: string): Promise<AppSettings> {
  const row = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return toAppSettings(row);
}

export async function updateSettings(organizationId: string, patch: Partial<Omit<AppSettings, "updatedAt">>): Promise<AppSettings> {
  const { organizationName, ...rest } = patch;
  const row = await prisma.organization.update({
    where: { id: organizationId },
    data: { ...rest, ...(organizationName !== undefined && { name: organizationName }) },
  });
  return toAppSettings(row);
}

/** Detection sensitivity alone, for the ingestion path that needs nothing else. */
export async function getSensitivity(organizationId: string): Promise<Sensitivity> {
  const row = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { detectionSensitivity: true },
  });
  return (row?.detectionSensitivity as Sensitivity) ?? "MEDIUM";
}
