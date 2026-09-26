"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-lg border border-border bg-panel p-10 text-center">
      <AlertTriangle className="size-8 text-high" />
      <h2 className="mt-3 text-lg font-semibold">Something went wrong</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">The console hit an unexpected error while loading this view. Your data is safe — try again, and check the server logs if the problem persists.</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-muted-foreground">Reference {error.digest}</p>}
      <Button className="mt-5" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
