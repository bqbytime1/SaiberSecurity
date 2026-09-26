import type { Metadata } from "next";
import { getAnalytics } from "@/lib/metrics";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const data = await getAnalytics();
  return <AnalyticsView data={data} />;
}
