import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser, adminSections } from "@/lib/auth";
import { listSchoolYears, getActiveSchoolYear } from "@/lib/school-year";
import { listSuiviFiches, pendingUnlockRequestsForYear } from "@/lib/fiche";
import { SuiviTable } from "@/components/admin/suivi-table";

const YEAR_COOKIE = "pm_year";

export default async function AdminSuiviPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sections = adminSections(user.roles);
  if (sections.length === 0) redirect("/");

  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;
  const [years, activeYear] = await Promise.all([listSchoolYears(), getActiveSchoolYear()]);
  const year = years.find((y) => y.id === cookieYear) ?? activeYear ?? years[0] ?? null;
  if (!year) {
    return <div className="p-10 text-center text-sm text-slate-500">Aucune année scolaire.</div>;
  }

  const [fiches, requests] = await Promise.all([
    listSuiviFiches(year.id, sections),
    pendingUnlockRequestsForYear(year.id, sections),
  ]);

  return (
    <SuiviTable
      yearId={year.id}
      yearLabel={year.label}
      sections={sections}
      initialFiches={fiches}
      initialRequests={requests}
    />
  );
}
