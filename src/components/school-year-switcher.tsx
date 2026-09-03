"use client";

import { useTransition } from "react";
import { setActiveYear } from "@/app/actions/year";
import type { SchoolYear } from "@/lib/school-year";

export function SchoolYearSwitcher({
  years,
  currentYearId,
}: {
  years: SchoolYear[];
  currentYearId?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (!value) return;
    startTransition(() => {
      setActiveYear(value);
    });
  }

  if (years.length === 0) {
    return (
      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
        Année scolaire — à créer
      </span>
    );
  }

  const current = years.find((y) => y.id === currentYearId) ?? years[0];

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current.id}
        onChange={onChange}
        disabled={pending}
        aria-label="Année scolaire"
        className="cursor-pointer appearance-none rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-7 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.label}
            {y.status === "archived" ? " (archivée)" : y.status === "upcoming" ? " (à venir)" : ""}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-slate-400"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.23 8.29a.75.75 0 01.02-1.08z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
