import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getDashboardMetrics } from "@/lib/metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const metrics = await getDashboardMetrics(user.organizationId);
  return <DashboardView metrics={metrics} />;
}
