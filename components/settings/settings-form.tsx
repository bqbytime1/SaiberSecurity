"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { AiProviderStatus } from "@/lib/ai";
import type { Sensitivity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

interface SettingsValues {
  organizationName: string;
  detectionSensitivity: Sensitivity;
  autoSimulate: boolean;
  autoSimulateInterval: number;
}

const SENSITIVITY_HELP: Record<Sensitivity, string> = {
  LOW: "Scores are scaled by 0.85× — fewer alerts, more tolerance for noisy environments.",
  MEDIUM: "Balanced default. Scores use the engine's calibrated weights.",
  HIGH: "Scores are scaled by 1.15× — earlier escalation at the cost of more medium-severity noise.",
};

export function SettingsForm({ initial, ai }: { initial: SettingsValues; ai: AiProviderStatus }) {
  const router = useRouter();
  const [values, setValues] = useState<SettingsValues>(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save settings");
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>Displayed in the console header and reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor="org">Organization name</Label>
            <Input id="org" value={values.organizationName} maxLength={80} onChange={(e) => setValues({ ...values, organizationName: e.target.value })} className="max-w-md" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detection sensitivity</CardTitle>
            <CardDescription>Applies a global multiplier to anomaly scores for newly ingested events. Existing scores are not recalculated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="sensitivity">Sensitivity</Label>
            <Select value={values.detectionSensitivity} onValueChange={(v) => setValues({ ...values, detectionSensitivity: v as Sensitivity })}>
              <SelectTrigger id="sensitivity" className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium (recommended)</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SENSITIVITY_HELP[values.detectionSensitivity]}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automatic event simulation</CardTitle>
            <CardDescription>Continuously generate realistic synthetic activity while the console is open, to demo live detection.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="autosim" className="text-sm text-foreground">
                  Enable automatic simulation
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Runs in the browser while you are signed in; pauses when the tab is hidden.</p>
              </div>
              <Switch id="autosim" checked={values.autoSimulate} onCheckedChange={(checked) => setValues({ ...values, autoSimulate: checked })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interval">Interval (seconds)</Label>
              <Input
                id="interval"
                type="number"
                min={30}
                max={60}
                step={5}
                value={values.autoSimulateInterval}
                onChange={(e) => setValues({ ...values, autoSimulateInterval: Math.min(60, Math.max(30, Number(e.target.value) || 30)) })}
                className="w-32"
                disabled={!values.autoSimulate}
              />
              <p className="text-xs text-muted-foreground">Between 30 and 60 seconds.</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !dirty}>
            {pending && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-low" role="status">
              <CheckCircle2 className="size-3.5" /> Saved
            </span>
          )}
          {error && (
            <span className="text-xs text-critical" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>AI provider</CardTitle>
            <CardDescription>Incident explanations and recommendations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              {ai.configured ? <Badge variant="low">Configured</Badge> : <Badge variant="info">Local engine</Badge>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Mode</span>
              <span className="font-medium">{ai.configured ? "Remote (OpenAI-compatible)" : "Deterministic fallback"}</span>
            </div>
            {ai.configured && (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Endpoint</span>
                  <span className="truncate font-mono text-xs">{ai.baseUrl}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-mono text-xs">{ai.model}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">API key</span>
              <span className="font-mono text-xs">{ai.configured ? "•••••••• (set)" : "not set"}</span>
            </div>
            <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              Configure <span className="font-mono">AI_API_KEY</span>, <span className="font-mono">AI_BASE_URL</span> and <span className="font-mono">AI_MODEL</span> in the server environment to enable a remote provider. Keys are never exposed to the browser. Without a key, the
              local engine produces evidence-based explanations from the incident data.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Planned connectors — not yet available.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {["AWS CloudTrail", "Microsoft 365", "Google Workspace", "Okta", "CrowdStrike", "Slack / Teams alerts", "SIEM export"].map((name) => (
                <li key={name} className="flex items-center justify-between">
                  <span>{name}</span>
                  <Badge variant="secondary">Roadmap</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
