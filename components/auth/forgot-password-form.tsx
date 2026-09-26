"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!available) {
    return (
      <p className="rounded-md border border-border bg-muted px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        Password reset is turned off on this deployment. Ask an administrator to reset your password for you.
      </p>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; devLink?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return;
      }
      setMessage(body.message ?? "Check your email.");
      setDevLink(body.devLink ?? null);
      setSent(true);
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="flex items-start gap-2 rounded-md border border-low/40 bg-low-muted px-3 py-3 text-xs leading-relaxed text-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-low" />
          {message}
        </p>
        {devLink && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            No mail provider is configured, so the link is shown here for local testing:
            <Link href={devLink.replace(/^https?:\/\/[^/]+/, "")} className="mt-1.5 block break-all font-mono text-primary hover:underline">
              {devLink}
            </Link>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="forgot-email">Email</Label>
        <Input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
        <p className="text-[11px] text-muted-foreground">We send a link that expires in one hour and works once.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
