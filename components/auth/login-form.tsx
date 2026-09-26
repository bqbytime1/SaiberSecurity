"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DemoHint {
  email: string;
  password: string;
}

/**
 * The demo credentials are supplied by the server, never written here.
 *
 * A literal in this file would be compiled into the browser bundle and served to every
 * anonymous visitor, which on a public deployment publishes a working login. The server
 * decides whether to send them at all (see app/login/page.tsx).
 */
export function LoginForm({ notice, demo }: { notice?: string | null; demo?: DemoHint | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A notice handed down from an identity-provider redirect is shown until the user
  // submits the form, at which point the submission's own result takes over.
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const visibleNotice = !dismissedNotice && !error ? (notice ?? null) : null;

  async function submit(credentials: { email: string; password: string }) {
    setPending(true);
    setError(null);
    setDismissedNotice(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Unable to sign in");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit({ email, password });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-[11px] text-muted-foreground hover:text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
      </div>
      {visibleNotice && (
        <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {visibleNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
      {demo && (
        <p className="pt-1 text-center text-[11px] text-muted-foreground">
          Demo credentials: <span className="font-mono text-foreground/80">{demo.email}</span> / <span className="font-mono text-foreground/80">{demo.password}</span>
        </p>
      )}
    </form>
  );
}
