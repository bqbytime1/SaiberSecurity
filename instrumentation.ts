/**
 * Next.js calls register() once per server process, before any request is handled.
 * That makes it the right place to start continuous collection, so monitoring runs
 * whether or not a browser has the console open.
 */
export async function register() {
  // Guard the runtime: this must not run in the edge runtime, where child processes
  // and the Prisma client are unavailable.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isMonitorEnabled, startMonitor } = await import("./lib/monitor");
  if (!isMonitorEnabled()) {
    console.log("[monitor] host collector disabled (set HOST_MONITOR_ENABLED=true to turn it on)");
    return;
  }
  startMonitor();
}
