-- Introduce the organization as the tenancy boundary.
--
-- Everything that already exists belongs to one organization, carried over from the
-- old single-row OrgSettings so its name and detection sensitivity survive. New
-- sign-ups create their own organization and therefore start empty.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'My organization',
    "detectionSensitivity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "autoSimulate" BOOLEAN NOT NULL DEFAULT false,
    "autoSimulateInterval" INTEGER NOT NULL DEFAULT 45,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Carry the previous settings across, when they exist.
INSERT INTO "Organization" ("id", "name", "detectionSensitivity", "autoSimulate", "autoSimulateInterval", "createdAt", "updatedAt")
SELECT 'org_default', "organizationName", "detectionSensitivity", "autoSimulate", "autoSimulateInterval", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "OrgSettings" WHERE "id" = 'default';

-- Otherwise create the destination anyway, so the backfill below always has a target.
INSERT INTO "Organization" ("id", "name", "detectionSensitivity", "autoSimulate", "autoSimulateInterval", "createdAt", "updatedAt")
SELECT 'org_default', 'My organization', 'MEDIUM', false, 45, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = 'org_default');

-- RedefineTables
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "emailVerified" DATETIME,
    "phone" TEXT,
    "phoneVerified" DATETIME,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "signupMethod" TEXT NOT NULL DEFAULT 'password',
    "organizationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "name", "passwordHash", "phone", "phoneVerified", "signupMethod", "organizationId")
SELECT "createdAt", "email", "emailVerified", "id", "image", "name", "passwordHash", "phone", "phoneVerified", "signupMethod", 'org_default' FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

CREATE TABLE "new_Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL,
    "correlationKey" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "affectedUser" TEXT,
    "primaryIp" TEXT,
    "detectionReasons" TEXT,
    "aiExplanation" TEXT,
    "recommendedActions" TEXT,
    "aiProvider" TEXT NOT NULL DEFAULT 'local',
    "firstEventAt" DATETIME NOT NULL,
    "lastEventAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Incident" ("affectedUser", "aiExplanation", "aiProvider", "category", "correlationKey", "createdAt", "description", "detectionReasons", "eventCount", "firstEventAt", "id", "lastEventAt", "primaryIp", "recommendedActions", "resolvedAt", "riskScore", "severity", "status", "title", "updatedAt", "organizationId")
SELECT "affectedUser", "aiExplanation", "aiProvider", "category", "correlationKey", "createdAt", "description", "detectionReasons", "eventCount", "firstEventAt", "id", "lastEventAt", "primaryIp", "recommendedActions", "resolvedAt", "riskScore", "severity", "status", "title", "updatedAt", 'org_default' FROM "Incident";
DROP TABLE "Incident";
ALTER TABLE "new_Incident" RENAME TO "Incident";
CREATE INDEX "Incident_organizationId_createdAt_idx" ON "Incident"("organizationId", "createdAt");
CREATE INDEX "Incident_organizationId_status_idx" ON "Incident"("organizationId", "status");
CREATE INDEX "Incident_organizationId_severity_idx" ON "Incident"("organizationId", "severity");
CREATE INDEX "Incident_organizationId_correlationKey_idx" ON "Incident"("organizationId", "correlationKey");

CREATE TABLE "new_SecurityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "user" TEXT,
    "sourceIp" TEXT NOT NULL,
    "destinationIp" TEXT,
    "country" TEXT,
    "device" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" TEXT,
    "anomalyScore" INTEGER NOT NULL DEFAULT 0,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'LOW',
    "scoreFactors" TEXT,
    "incidentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SecurityEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SecurityEvent" ("action", "anomalyScore", "country", "createdAt", "destinationIp", "device", "eventType", "id", "incidentId", "metadata", "riskScore", "scoreFactors", "severity", "source", "sourceIp", "status", "timestamp", "user", "organizationId")
SELECT "action", "anomalyScore", "country", "createdAt", "destinationIp", "device", "eventType", "id", "incidentId", "metadata", "riskScore", "scoreFactors", "severity", "source", "sourceIp", "status", "timestamp", "user", 'org_default' FROM "SecurityEvent";
DROP TABLE "SecurityEvent";
ALTER TABLE "new_SecurityEvent" RENAME TO "SecurityEvent";
CREATE INDEX "SecurityEvent_organizationId_timestamp_idx" ON "SecurityEvent"("organizationId", "timestamp");
CREATE INDEX "SecurityEvent_organizationId_severity_idx" ON "SecurityEvent"("organizationId", "severity");
CREATE INDEX "SecurityEvent_organizationId_riskScore_idx" ON "SecurityEvent"("organizationId", "riskScore");
CREATE INDEX "SecurityEvent_organizationId_eventType_idx" ON "SecurityEvent"("organizationId", "eventType");
CREATE INDEX "SecurityEvent_organizationId_sourceIp_idx" ON "SecurityEvent"("organizationId", "sourceIp");
CREATE INDEX "SecurityEvent_organizationId_user_idx" ON "SecurityEvent"("organizationId", "user");
CREATE INDEX "SecurityEvent_organizationId_source_idx" ON "SecurityEvent"("organizationId", "source");
CREATE INDEX "SecurityEvent_incidentId_idx" ON "SecurityEvent"("incidentId");

-- The settings this replaced.
DROP TABLE "OrgSettings";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
