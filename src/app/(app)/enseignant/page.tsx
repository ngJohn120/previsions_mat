import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listSchoolYears, getActiveSchoolYear } from "@/lib/school-year";
import { listFicheItems } from "@/lib/fiche";
import { FicheList } from "@/components/enseignant/fiche-list";

const YEAR_COOKIE = "pm_year";

export default async function EnseignantDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;
  const [years, activeYear] = await Promise.all([
    listSchoolYears(),
    getActiveSchoolYear(),
  ]);
  const currentYear =
    years.find((y) => y.id === cookieYear) ?? activeYear ?? years[0] ?? null;
  if (!currentYear) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Mes fiches</h1>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Aucune année scolaire active. Contactez la direction.
        </div>
      </div>
    );
  }

  // Always "Mes fiches": attributions where the current user is the teacher.
  const fiches = await listFicheItems(currentYear.id, user.id);

  return (
    <FicheList
      yearId={currentYear.id}
      yearLabel={currentYear.label}
      userName={user.fullName ?? user.email ?? ""}
      viewerIsAdmin={false}
      initialFiches={fiches}
    />
  );
}
