"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryParamUpdater } from "./use-query-params";
import { cn } from "@/lib/utils";

export function FilterSelect({
  paramKey,
  value,
  options,
  allLabel,
  className,
  ariaLabel,
}: {
  paramKey: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  className?: string;
  ariaLabel?: string;
}) {
  const update = useQueryParamUpdater();
  return (
    <Select value={value ?? "all"} onValueChange={(v) => update({ [paramKey]: v })}>
      <SelectTrigger className={cn("h-9", className)} aria-label={ariaLabel ?? allLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
