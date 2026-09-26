import type { Metadata } from "next";
import { getDashboardMetrics } from "@/lib/metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const metrics = await getDashboardMetrics();
  return <DashboardView metrics={metrics} />;
}
