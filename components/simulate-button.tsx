"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SimulateResult {
  created: number;
  suspicious: number;
  incidentsCreated: number;
  incidentsUpdated: number;
}

export function SimulateButton({ className, size = "default" }: { className?: string; size?: "default" | "sm" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!result && !error) return;
    const id = setTimeout(() => {
      setResult(null);
      setError(null);
    }, 6000);
    return () => clearTimeout(id);
  }, [result, error]);

  async function simulate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as Partial<SimulateResult> & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Simulation failed");
        return;
      }
      setResult({ created: body.created ?? 0, suspicious: body.suspicious ?? 0, incidentsCreated: body.incidentsCreated ?? 0, incidentsUpdated: body.incidentsUpdated ?? 0 });
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {result && (
        <span className="hidden text-xs text-muted-foreground sm:inline" role="status">
          +{result.created} events · {result.suspicious} suspicious · {result.incidentsCreated} new / {result.incidentsUpdated} updated incidents
        </span>
      )}
      {error && (
        <span className="text-xs text-critical" role="alert">
          {error}
        </span>
      )}
      <Button size={size} onClick={() => void simulate()} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Zap />}
        {pending ? "Simulating…" : "Simulate New Events"}
      </Button>
    </div>
  );
}
