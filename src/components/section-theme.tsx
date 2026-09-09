"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * GradeApp-style section theming. Sets html[data-section] for the current
 * section context — from the URL path (/primaire/*, /secondaire/*) or, for
 * admin pages that switch via query param (e.g. /admin/calendrier?section=…),
 * from ?section=. Everything else gets the default theme. Re-evaluates on
 * every navigation.
 */
export function SectionTheme() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const root = document.documentElement;
    const qp = searchParams?.get("section");
    const section =
      qp === "primaire" || qp === "secondaire"
        ? qp
        : pathname.startsWith("/primaire")
          ? "primaire"
          : pathname.startsWith("/secondaire")
            ? "secondaire"
            : null;
    if (section) {
      root.setAttribute("data-section", section);
    } else {
      root.removeAttribute("data-section");
    }
  }, [pathname, searchParams]);

  return null;
}
