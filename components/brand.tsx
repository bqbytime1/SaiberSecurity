import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={cn("size-7", className)} aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" stroke="var(--color-primary)" strokeWidth="1.5" fill="rgba(34,184,224,0.08)" />
      <path d="M16 7.5 L24 11 V17.5 C24 21.5 20.5 24.2 16 25.5 C11.5 24.2 8 21.5 8 17.5 V11 Z" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M12 16.5 L15 19.5 L20.5 13.5" stroke="var(--color-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The wordmark. Pass `href` to make it a link, which is what people expect of a logo
 * in a product's own navigation; leave it off on the sign-in pages, where there is
 * nowhere signed-out to go.
 */
export function BrandWordmark({ className, subtitle, href }: { className?: string; subtitle?: string; href?: string }) {
  const content = (
    <>
      <BrandMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-foreground">SaiberSecurity</div>
        {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
    </>
  );

  if (!href) return <div className={cn("flex items-center gap-2.5", className)}>{content}</div>;

  return (
    <Link
      href={href}
      aria-label="SaiberSecurity home"
      className={cn(
        "flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        className,
      )}
    >
      {content}
    </Link>
  );
}
