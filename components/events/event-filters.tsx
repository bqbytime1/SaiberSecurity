"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { useQueryParamUpdater } from "@/components/use-query-params";

interface Props {
  query: { severity?: string; eventType?: string; user?: string; sourceIp?: string; search?: string; date?: string; minRisk?: number };
  severities: string[];
  eventTypes: Array<{ value: string; label: string }>;
  users: string[];
  total: number;
}

export function EventFilters({ query, severities, eventTypes, users, total }: Props) {
  const update = useQueryParamUpdater();
  const active = Boolean(query.severity || query.eventType || query.user || query.sourceIp || query.search || query.date || query.minRisk !== undefined);

  function onDate(value: string) {
    if (!value) {
      update({ date: undefined, from: undefined, to: undefined });
      return;
    }
    update({ date: value, from: `${value}T00:00:00.000Z`, to: `${value}T23:59:59.999Z` });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <SearchInput initial={query.search ?? ""} placeholder="Search user, IP, action…" className="w-full sm:w-60" />
      <FilterSelect paramKey="severity" value={query.severity} allLabel="All severities" options={severities.map((s) => ({ value: s, label: s }))} className="w-36" />
      <FilterSelect paramKey="eventType" value={query.eventType} allLabel="All event types" options={eventTypes} className="w-44" />
      <FilterSelect paramKey="user" value={query.user} allLabel="All users" options={users.map((u) => ({ value: u, label: u }))} className="w-44" />
      <Input value={query.sourceIp ?? ""} onChange={(e) => update({ sourceIp: e.target.value || undefined })} placeholder="Source IP" className="w-36 font-mono text-xs" aria-label="Source IP" />
      <Input type="date" value={query.date ?? ""} onChange={(e) => onDate(e.target.value)} className="w-40" aria-label="Date" />
      <FilterSelect
        paramKey="minRisk"
        value={query.minRisk !== undefined ? String(query.minRisk) : undefined}
        allLabel="Any risk"
        options={[
          { value: "30", label: "Risk ≥ 30" },
          { value: "55", label: "Risk ≥ 55" },
          { value: "80", label: "Risk ≥ 80" },
        ]}
        className="w-32"
      />
      {active && (
        <Button variant="ghost" size="sm" onClick={() => update({ severity: undefined, eventType: undefined, user: undefined, sourceIp: undefined, search: undefined, date: undefined, from: undefined, to: undefined, minRisk: undefined })}>
          <X />
          Clear
        </Button>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        {total.toLocaleString()} event{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
