import { AlertTriangle } from "lucide-react";
import { runHealthChecks } from "@/lib/health";

/**
 * Tells an operator why this deployment cannot sign anyone in.
 *
 * Without it, a missing SESSION_SECRET or an unmigrated database shows up only as
 * "Internal server error" after you fill in the form — which reads as a bug in the app
 * rather than a value nobody set, and sends you looking in the wrong place entirely.
 *
 * It renders nothing when the deployment is healthy, which is the normal case.
 *
 * On what this discloses: it names which setting is wrong to anyone who opens the page.
 * That is the same information /api/health returns, and it appears only on a deployment
 * that cannot authenticate anybody, so there is no account it could help anyone reach.
 * It never includes a value, a connection string, or a raw driver error.
 */
export async function ConfigBanner() {
  const checks = await runHealthChecks();
  const problems = checks.filter((c) => !c.ok);
  if (problems.length === 0) return null;

  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-critical/40 bg-critical-muted px-3 py-3 text-xs leading-relaxed text-foreground"
    >
      <p className="flex items-start gap-2 font-medium text-critical">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        This deployment is not finished being set up, so signing in will fail.
      </p>
      <ul className="space-y-1 pl-6">
        {problems.map((p) => (
          <li key={p.name} className="break-words">
            <span className="font-medium">{p.label}:</span> {p.detail}
          </li>
        ))}
      </ul>
      <p className="pl-6 text-muted-foreground">
        Set these in the hosting environment and redeploy. Full status at{" "}
        <span className="font-mono text-foreground/80">/api/health</span>.
      </p>
    </div>
  );
}
