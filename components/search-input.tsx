"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useQueryParamUpdater } from "./use-query-params";
import { cn } from "@/lib/utils";

export function SearchInput({ paramKey = "search", initial = "", placeholder = "Search…", className }: { paramKey?: string; initial?: string; placeholder?: string; className?: string }) {
  const update = useQueryParamUpdater();
  const [value, setValue] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setValue(initial);
  }

  useEffect(() => {
    if (value === initial) return;
    const id = setTimeout(() => update({ [paramKey]: value.trim() || undefined }), 350);
    return () => clearTimeout(id);
  }, [value, initial, paramKey, update]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
    </div>
  );
}
