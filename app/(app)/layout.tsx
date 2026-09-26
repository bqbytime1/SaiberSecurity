import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAiProviderStatus } from "@/lib/ai";
import { getSettings } from "@/lib/settings";
import { computeThreatLevel } from "@/lib/metrics";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [settings, threat] = await Promise.all([getSettings(user.organizationId), computeThreatLevel(user.organizationId)]);
  const ai = getAiProviderStatus();

  return (
    <AppShell
      user={user}
      organizationName={settings.organizationName}
      threatLevel={threat.level}
      ai={{ configured: ai.configured, model: ai.model }}
      autoSimulate={settings.autoSimulate}
      autoSimulateInterval={settings.autoSimulateInterval}
    >
      {children}
    </AppShell>
  );
}
