"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Status {
  running: boolean;
  enabled: boolean;
  host: string | null;
  intervalMs: number;
  lastPollAt: string | null;
  connectionsSeen: number;
  externalConnections: number;
}

/**
 * One-line proof on the dashboard that collection is live.
 *
 * It refreshes the server-rendered dashboard whenever the collector reports new
 * events, so the figures above move on their own instead of going stale until
 * someone presses a button.
 */
export function LiveStrip({ pollMs = 5000 }: { pollMs?: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    let lastCount = collected;

    async function tick() {
      try {
        const res = await fetch("/api/monitor?limit=1", { cache: "no-store" });
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: { status: Status; totals: { collected: number } } };
        setStatus(data.status);
        setCollected(data.totals.collected);
        // New telemetry landed, so the surrounding server-rendered figures are stale.
        if (lastCount !== null && data.totals.collected !== lastCount) router.refresh();
        lastCount = data.totals.collected;
      } catch {
        // A transient failure just means the next tick tries again.
      }
    }

    void tick();
    const dataTimer = setInterval(() => void tick(), pollMs);
    const clockTimer = setInterval(() => {
      setStatus((s) => {
        if (s?.lastPollAt) setAge(Math.max(0, Math.round((Date.now() - new Date(s.lastPollAt).getTime()) / 1000)));
        return s;
      });
    }, 1000);

    return () => {
      clearInterval(dataTimer);
      clearInterval(clockTimer);
    };
    // `collected` is seeded once; re-running on every change would reset the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, router]);

  if (!status) return null;
  const live = status.running;

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 text-xs", live ? "border-primary/40 bg-primary-muted/30" : "border-border bg-muted")}>
      <span className="flex items-center gap-2 font-medium">
        <span className="relative flex size-2">
          {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />}
          <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-primary" : "bg-muted-foreground")} />
        </span>
        {live ? "Live monitoring" : "Collector paused"}
      </span>

      {live ? (
        <span className="text-muted-foreground">
          Reading real connections from <span className="font-mono text-foreground">{status.host}</span> every {Math.round(status.intervalMs / 1000)}s
        </span>
      ) : (
        <span className="text-muted-foreground">Host collection is not running.</span>
      )}

      <span className="text-muted-foreground">
        <span className="font-mono text-foreground">{status.externalConnections}</span> external of{" "}
        <span className="font-mono text-foreground">{status.connectionsSeen}</span> open connections
      </span>
      {collected !== null && (
        <span className="text-muted-foreground">
          <span className="font-mono text-foreground">{collected}</span> events collected
        </span>
      )}
      {age !== null && <span className="text-muted-foreground">last sample {age}s ago</span>}

      <Link href="/live" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
        Live view
        <ArrowUpRight className="size-3" />
      </Link>
    </div>
  );
}
