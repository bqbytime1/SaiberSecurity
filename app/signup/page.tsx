import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listOAuthProviders } from "@/lib/oauth";
import { isPhoneSignupAvailable } from "@/lib/phone";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthDivider, ProviderButtons } from "@/components/auth/provider-buttons";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const providers = listOAuthProviders();
  const phoneAvailable = isPhoneSignupAvailable();

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start monitoring behavioural anomalies across your environment."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <div className="space-y-4">
        <ProviderButtons providers={providers} action="signup" />
        <AuthDivider label="or sign up with" />
        <SignupForm phoneAvailable={phoneAvailable} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          By creating an account you agree to keep this deployment&apos;s data handling consistent with your organisation&apos;s policy.
        </p>
      </div>
    </AuthLayout>
  );
}
