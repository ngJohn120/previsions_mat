"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavLink = { href: string; label: string; show: boolean };
export type Sections = ("primaire" | "secondaire")[];

/**
 * Shared role-aware links used by both the desktop bar and the mobile drawer.
 *
 * Role boundaries (mirroring the route guards):
 * - Utilisateurs, Année, Calendrier → super admin only
 * - Suivi, Branches → any admin (super or section)
 * - Structure / Attributions → only for the section(s) this user administers
 */
export function buildNavLinks(
  superAdmin: boolean,
  sections: Sections,
  isAdmin: boolean
): NavLink[] {
  const links: NavLink[] = [
    { href: "/enseignant", label: "Mes fiches", show: true },
  ];
  if (isAdmin) {
    links.push({ href: `/admin/branches`, label: "Branches", show: true });
    links.push({ href: "/admin/suivi", label: "Suivi", show: true });
    if (superAdmin) {
      links.push({ href: `/admin/calendrier`, label: "Calendrier", show: true });
      links.push({ href: `/admin/utilisateurs`, label: "Utilisateurs", show: true });
      links.push({ href: `/admin/annee`, label: "Année", show: true });
    }
    for (const s of sections) {
      links.push({ href: `/${s}/structure`, label: s === "primaire" ? "Structure P." : "Structure S.", show: true });
      links.push({ href: `/${s}/attributions`, label: s === "primaire" ? "Attributions P." : "Attributions S.", show: true });
    }
  }
  return links.filter((l) => l.show);
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

/**
 * Desktop topbar navigation. Hidden below `md` — the burger + MobileNav take over.
 */
export function MainNav({
  superAdmin,
  isAdmin,
  sections,
}: {
  superAdmin: boolean;
  isAdmin: boolean;
  sections: Sections;
}) {
  const pathname = usePathname();
  const links = buildNavLinks(superAdmin, sections, isAdmin);

  return (
    <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Navigation principale">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            isActive(pathname, l.href)
              ? "bg-blue-50 text-blue-700"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Mobile navigation: hamburger button (visible below `md`) that opens a
 * left slide-in drawer with the same role-aware links as the desktop bar.
 */
export function MobileNav({
  superAdmin,
  isAdmin,
  sections,
}: {
  superAdmin: boolean;
  isAdmin: boolean;
  sections: Sections;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const links = buildNavLinks(superAdmin, sections, isAdmin);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Ouvrir le menu"
        className="md:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu />
      </Button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          />
          <DialogPrimitive.Popup
            data-slot="mobile-nav"
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl ring-1 ring-slate-900/5 duration-150 outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-left-full",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-left-full"
            )}
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-200 pl-4 pr-2">
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-700 text-white text-sm font-extrabold">
                  S
                </span>
                <span className="text-sm font-bold text-slate-800">Prévisions Matières</span>
              </span>
              <DialogPrimitive.Close
                render={
                  <Button variant="ghost" size="icon" aria-label="Fermer le menu" />
                }
              >
                <XIcon />
              </DialogPrimitive.Close>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navigation mobile">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={(e) => {
                    e.preventDefault();
                    go(l.href);
                  }}
                  className={cn(
                    "flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    isActive(pathname, l.href)
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                  )}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
