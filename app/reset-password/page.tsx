import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { PASSWORD_MIN_LENGTH } from "@/lib/validations";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

// No signed-in redirect here: someone recovering an account may still hold a stale
// session in another tab, and they should be able to finish the reset regardless.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Setting a new password signs out every device that was using the old one."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ResetPasswordForm token={raw ?? ""} minLength={PASSWORD_MIN_LENGTH} />
    </AuthLayout>
  );
}
