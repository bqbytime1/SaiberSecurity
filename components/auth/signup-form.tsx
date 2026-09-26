"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PASSWORD_MIN_LENGTH } from "@/lib/validations";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical-muted px-3 py-2 text-xs text-critical">
      {message}
    </p>
  );
}

async function postJson(url: string, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (data.error as string) ?? "Something went wrong" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error — please try again" };
  }
}

function EmailSignup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await postJson("/api/auth/signup", { name, email, password });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Full name</Label>
        <Input id="signup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Chen" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Work email</Label>
        <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input id="signup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        <p className="text-[11px] text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters. Avoid common passwords and anything containing your email name.</p>
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Create account
      </Button>
    </form>
  );
}

function PhoneSignup({ available }: { available: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"entry" | "code">("entry");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!available) {
    return (
      <p className="rounded-md border border-border bg-muted px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        Phone sign-up is not configured on this deployment. Set the Twilio credentials described in the README to enable it.
      </p>
    );
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setPending(true);
    setError(null);
    const res = await postJson("/api/auth/phone/start", { phone, name: name || undefined });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSentTo((res.data.to as string) ?? phone);
    setDevCode((res.data.devCode as string) ?? null);
    setCode("");
    setStep("code");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await postJson("/api/auth/phone/verify", { phone, code, name: name || undefined });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (step === "entry") {
    return (
      <form onSubmit={sendCode} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="phone-name">Full name</Label>
          <Input id="phone-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Chen" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone-number">Phone number</Label>
          <Input id="phone-number" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 010 0199" required />
          <p className="text-[11px] text-muted-foreground">Include your country code. We text a six-digit code that expires in 10 minutes.</p>
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Send verification code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="phone-code">Verification code</Label>
        <Input
          id="phone-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="text-center font-mono text-lg tracking-[0.4em]"
          required
        />
        <p className="text-[11px] text-muted-foreground">Sent to {sentTo}.</p>
      </div>
      {devCode && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          No SMS provider is configured, so the code is shown here for local testing: <span className="font-mono text-foreground">{devCode}</span>
        </p>
      )}
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
        {pending && <Loader2 className="animate-spin" />}
        Verify and continue
      </Button>
      <div className="flex items-center justify-between text-[11px]">
        <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setStep("entry")} disabled={pending}>
          <ArrowLeft className="size-3" />
          Change number
        </button>
        <button type="button" className="text-primary hover:underline" onClick={() => void sendCode()} disabled={pending}>
          Resend code
        </button>
      </div>
    </form>
  );
}

export function SignupForm({ phoneAvailable }: { phoneAvailable: boolean }) {
  return (
    <Tabs defaultValue="email">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="email">Email</TabsTrigger>
        <TabsTrigger value="phone">Phone</TabsTrigger>
      </TabsList>
      <TabsContent value="email">
        <EmailSignup />
      </TabsContent>
      <TabsContent value="phone">
        <PhoneSignup available={phoneAvailable} />
      </TabsContent>
    </Tabs>
  );
}
