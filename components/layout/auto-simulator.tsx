"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadioTower } from "lucide-react";

/**
 * When automatic simulation is enabled in Settings, this component drives it
 * from the browser: every `intervalSeconds` it asks the server to generate and
 * ingest a burst of events, then refreshes the current server-rendered page.
 */
export function AutoSimulator({ enabled, intervalSeconds }: { enabled: boolean; intervalSeconds: number }) {
  const router = useRouter();
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const interval = Math.min(60, Math.max(30, intervalSeconds)) * 1000;
    const tick = async () => {
      if (inFlight.current || document.hidden) return;
      inFlight.current = true;
      setRunning(true);
      try {
        const res = await fetch("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (res.ok) {
          setLastRun(new Date());
          router.refresh();
        }
      } catch {
        // transient network failures are ignored; the next tick retries
      } finally {
        inFlight.current = false;
        setRunning(false);
      }
    };
    const id = setInterval(() => void tick(), interval);
    return () => clearInterval(id);
  }, [enabled, intervalSeconds, router]);

  if (!enabled) return null;

  return (
    <div className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground md:flex" title="Automatic event simulation is enabled in Settings">
      <RadioTower className={running ? "size-3.5 animate-pulse text-primary" : "size-3.5 text-primary"} />
      Live simulation · every {intervalSeconds}s
      {lastRun && <span className="text-muted-foreground/70">· last {lastRun.toISOString().slice(11, 19)} UTC</span>}
    </div>
  );
}
