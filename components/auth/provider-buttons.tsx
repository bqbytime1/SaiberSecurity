"use client";

import { Button } from "@/components/ui/button";

export interface ProviderOption {
  id: string;
  label: string;
  configured: boolean;
}

/** Brand glyphs, inline because the icon set ships no third-party logos. */
function ProviderIcon({ id }: { id: string }) {
  if (id === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.26a12 12 0 0 0 0 10.78l4.01-3.11Z" />
        <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
      </svg>
    );
  }
  if (id === "microsoft") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#F25022" d="M1 1h10.2v10.2H1z" />
        <path fill="#7FBA00" d="M12.8 1H23v10.2H12.8z" />
        <path fill="#00A4EF" d="M1 12.8h10.2V23H1z" />
        <path fill="#FFB900" d="M12.8 12.8H23V23H12.8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.3 3.5.99.1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

/**
 * One button per identity provider. A provider without credentials renders disabled
 * with an explanation rather than failing after the redirect.
 */
export function ProviderButtons({ providers, action, disabled }: { providers: ProviderOption[]; action: "signin" | "signup"; disabled?: boolean }) {
  if (providers.length === 0) return null;
  const anyConfigured = providers.some((p) => p.configured);
  const verb = action === "signup" ? "Sign up" : "Continue";

  return (
    <div className="space-y-2">
      {providers.map((p) =>
        // A configured provider is a plain link: starting the flow needs a full document
        // navigation, because the route redirects off-site to the provider. An
        // unconfigured one stays a disabled button so it cannot be followed.
        p.configured && !disabled ? (
          <Button key={p.id} asChild variant="secondary" className="w-full justify-center">
            <a href={`/api/auth/oauth/${p.id}`} rel="nofollow">
              <ProviderIcon id={p.id} />
              {verb} with {p.label}
            </a>
          </Button>
        ) : (
          <Button key={p.id} type="button" variant="secondary" className="w-full justify-center" disabled title={`${p.label} sign-in is not configured on this deployment`}>
            <ProviderIcon id={p.id} />
            {verb} with {p.label}
          </Button>
        ),
      )}
      {!anyConfigured && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Single sign-on is available once provider credentials are set. See “Sign-up and sign-in methods” in the README to enable Google, Microsoft or GitHub.
        </p>
      )}
    </div>
  );
}

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="relative py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className="bg-background px-2">{label}</span>
      <span className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
    </div>
  );
}
