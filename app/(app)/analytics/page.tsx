import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/metrics";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const data = await getAnalytics(user.organizationId);
  return <AnalyticsView data={data} />;
}
