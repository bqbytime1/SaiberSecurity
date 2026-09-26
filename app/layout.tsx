import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SaiberSecurity", template: "%s · SaiberSecurity" },
  description: "AI-powered security monitoring. SaiberSecurity learns what normal looks like across your users, devices, and infrastructure, then identifies the deviations that matter.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
