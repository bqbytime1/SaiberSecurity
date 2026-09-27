"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { ThreatLevel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { BrandWordmark } from "@/components/brand";
import { SidebarNav } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { SystemStatus } from "./system-status";
import { AutoSimulator } from "./auto-simulator";
import { cn } from "@/lib/utils";

interface AppShellProps {
  user: SessionUser;
  organizationName: string;
  threatLevel: ThreatLevel;
  ai: { configured: boolean; model: string | null };
  autoSimulate: boolean;
  autoSimulateInterval: number;
  children: React.ReactNode;
}

export function AppShell({ user, organizationName, threatLevel, ai, autoSimulate, autoSimulateInterval, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-panel transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <BrandWordmark subtitle="AI-powered security monitoring" href="/dashboard" />
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X />
          </Button>
        </div>
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Organization</p>
          <p className="mt-0.5 truncate text-sm font-medium">{organizationName}</p>
        </div>
        <SidebarNav onNavigate={() => setMobileOpen(false)} />
        <div className="mt-auto border-t border-border p-3">
          <SystemStatus threatLevel={threatLevel} ai={ai} />
        </div>
      </aside>

      {mobileOpen && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="min-w-0 flex-1" />
          <AutoSimulator enabled={autoSimulate} intervalSeconds={autoSimulateInterval} />
          <UserMenu user={user} />
        </header>
        <main id="main" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
