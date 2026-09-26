import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";

/** Split-screen shell shared by the sign-in and sign-up pages. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen">
      <section className="hidden w-[46%] flex-col justify-between border-r border-border bg-panel p-10 lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">SaiberSecurity</span>
        </div>
        <div className="max-w-md space-y-6">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-primary">AI-powered security monitoring.</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">Behavioral anomaly detection for modern security teams.</h1>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            SaiberSecurity learns what normal looks like across your users, devices, and infrastructure, then identifies the deviations that matter — correlating them into
            incidents, explaining them in plain language, and recommending defensive next steps.
          </p>
          <ul className="grid gap-3 text-sm text-muted-foreground">
            {["Explainable, server-side anomaly scoring", "Automatic incident correlation", "AI analysis with deterministic fallback", "Built for defenders — no offensive tooling"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="size-1.5 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getUTCFullYear()} SaiberSecurity. All systems monitored.</p>
      </section>

      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm py-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">SaiberSecurity</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
