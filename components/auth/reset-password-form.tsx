"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
          This link is missing its reset token. Request a new one.
        </p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirm }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      setDone(true);
      // Straight to sign-in: the reset revoked every session, so signing in with the
      // new password is the next step and confirms it took.
      setTimeout(() => router.push("/login"), 2200);
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-start gap-2 rounded-md border border-low/40 bg-low-muted px-3 py-3 text-xs leading-relaxed text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-low" />
          Your password is set. Every device that was signed in has been signed out. Taking you to sign in…
        </p>
        <Button asChild className="w-full">
          <Link href="/login">Sign in now</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" name="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        <p className="text-[11px] text-muted-foreground">At least {minLength} characters. Avoid common passwords.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm password</Label>
        <Input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Set new password
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/forgot-password" className="text-primary hover:underline">
          Request a new link
        </Link>
      </p>
    </form>
  );
}
