import type { Metadata } from "next";
import { getAiProviderStatus } from "@/lib/ai";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, ai] = await Promise.all([getSettings(), getAiProviderStatus()]);
  return (
    <div>
      <PageHeader title="Settings" description="Organization, detection tuning, simulation and AI provider status." />
      <SettingsForm
        initial={{
          organizationName: settings.organizationName,
          detectionSensitivity: settings.detectionSensitivity,
          autoSimulate: settings.autoSimulate,
          autoSimulateInterval: settings.autoSimulateInterval,
        }}
        ai={ai}
      />
    </div>
  );
}
