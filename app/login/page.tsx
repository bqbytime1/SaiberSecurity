import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listOAuthProviders } from "@/lib/oauth";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthDivider, ProviderButtons } from "@/components/auth/provider-buttons";
import { ConfigBanner } from "@/components/auth/config-banner";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/** Reason codes the OAuth routes redirect back with. */
const NOTICES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  unknown_provider: "That sign-in provider is not available.",
  provider_unconfigured: "That provider is not configured on this deployment.",
  provider_error: "The provider rejected the sign-in attempt.",
  missing_code: "The provider did not return an authorization code.",
  state_missing: "Your sign-in attempt expired. Please try again.",
  state_invalid: "Your sign-in attempt could not be verified. Please try again.",
  state_mismatch: "Your sign-in attempt could not be verified. Please try again.",
  exchange_failed: "We could not complete sign-in with that provider.",
  already_registered: "That email is already registered. Sign in with your password, then link the provider.",
};

/**
 * Demo credentials are shown only when this is clearly not a real deployment.
 *
 * Returning null keeps the strings out of the response entirely, so they are never
 * compiled into the browser bundle or readable by an anonymous visitor. Set
 * SHOW_DEMO_CREDENTIALS explicitly to override either way.
 */
function demoHint(): { email: string; password: string } | null {
  const flag = process.env.SHOW_DEMO_CREDENTIALS;
  const show = flag === "true" || (flag !== "false" && process.env.NODE_ENV !== "production");
  if (!show) return null;
  return { email: "demo@saibersecurity.com", password: "SaiberDemo2026!" };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  const raw = Array.isArray(params.error) ? params.error[0] : params.error;
  const notice = raw ? (NOTICES[raw] ?? "Sign-in could not be completed.") : null;
  const providers = listOAuthProviders();

  return (
    <AuthLayout
      title="Sign in to your console"
      subtitle="Use your analyst credentials to access the security operations console."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      }
    >
      <div className="space-y-4">
        <ConfigBanner />
        <ProviderButtons providers={providers} action="signin" />
        <AuthDivider label="or" />
        <LoginForm notice={notice} demo={demoHint()} />
      </div>
    </AuthLayout>
  );
}
