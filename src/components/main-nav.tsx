"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Lightweight role-aware nav in the topbar (no sidebar in this build).
 */
export function MainNav({
  isAdmin,
  sections,
}: {
  isAdmin: boolean;
  sections: ("primaire" | "secondaire")[];
}) {
  const pathname = usePathname();

  const links: { href: string; label: string; show: boolean }[] = [
    { href: "/enseignant", label: "Mes fiches", show: true },
    { href: "/notifications", label: "Notifications", show: true },
  ];
  if (isAdmin) {
    links.push({ href: "/admin/suivi", label: "Suivi", show: true });
    links.push({ href: `/admin/branches`, label: "Branches", show: true });
    links.push({ href: `/admin/calendrier`, label: "Calendrier", show: true });
    links.push({ href: `/admin/utilisateurs`, label: "Utilisateurs", show: true });
    links.push({ href: `/admin/annee`, label: "Année", show: true });
    for (const s of sections) {
      links.push({ href: `/${s}/structure`, label: s === "primaire" ? "Structure P." : "Structure S.", show: true });
      links.push({ href: `/${s}/attributions`, label: s === "primaire" ? "Attributions P." : "Attributions S.", show: true });
    }
  }

  return (
    <nav className="ml-2 hidden items-center gap-0.5 md:flex">
      {links.filter((l) => l.show).map((l) => {
        const active =
          pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              active
                ? "bg-blue-50 text-blue-700"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
