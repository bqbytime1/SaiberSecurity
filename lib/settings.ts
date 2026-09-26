import type { OrgSettings } from "@prisma/client";
import { prisma } from "./prisma";
import type { Sensitivity } from "./types";

export interface AppSettings {
  organizationName: string;
  detectionSensitivity: Sensitivity;
  autoSimulate: boolean;
  autoSimulateInterval: number;
  updatedAt: Date;
}

function toAppSettings(row: OrgSettings): AppSettings {
  return {
    organizationName: row.organizationName,
    detectionSensitivity: row.detectionSensitivity as Sensitivity,
    autoSimulate: row.autoSimulate,
    autoSimulateInterval: row.autoSimulateInterval,
    updatedAt: row.updatedAt,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.orgSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  return toAppSettings(row);
}

export async function updateSettings(patch: Partial<Omit<AppSettings, "updatedAt">>): Promise<AppSettings> {
  const row = await prisma.orgSettings.upsert({ where: { id: "default" }, update: patch, create: { id: "default", ...patch } });
  return toAppSettings(row);
}
