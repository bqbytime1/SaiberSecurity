import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { LiveMonitor } from "@/components/live/live-monitor";
import { requireUser } from "@/lib/auth";
import { getLiveSnapshot } from "@/lib/monitor";

export const metadata: Metadata = { title: "Live monitoring" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const user = await requireUser();
  const snapshot = await getLiveSnapshot(user.organizationId);

  return (
    <div>
      <PageHeader
        title="Live monitoring"
        description="Real network activity observed on the host running this server, collected continuously and scored by the same engine as every other event."
      />
      <LiveMonitor initial={snapshot} />
    </div>
  );
}
