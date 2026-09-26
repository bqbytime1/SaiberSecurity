import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-none", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-border bg-muted text-muted-foreground",
      outline: "border-border text-foreground",
      critical: "border-critical/40 bg-critical-muted text-critical",
      high: "border-high/40 bg-high-muted text-high",
      medium: "border-medium/40 bg-medium-muted text-medium",
      low: "border-low/40 bg-low-muted text-low",
      info: "border-info/40 bg-info-muted text-info",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
