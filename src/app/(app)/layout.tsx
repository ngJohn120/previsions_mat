import { cookies } from "next/headers";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { getActiveSchoolYear, listSchoolYears } from "@/lib/school-year";
import { SchoolYearSwitcher } from "@/components/school-year-switcher";
import { redirect } from "next/navigation";
import Link from "next/link";

const YEAR_COOKIE = "pm_year";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const [years, activeYear] = await Promise.all([
    listSchoolYears(),
    getActiveSchoolYear(),
  ]);

  // Resolve which year is "current": cookie > active DB year > first
  const currentYear =
    years.find((y) => y.id === cookieYear) ?? activeYear ?? years[0] ?? null;

  const superAdmin = isSuperAdmin(user.roles);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-700 text-white text-sm font-extrabold">
              S
            </span>
            <span className="hidden text-sm font-bold text-slate-800 sm:inline">
              Prévisions Matières
            </span>
          </Link>
          <div className="flex-1" />
          {currentYear && (
            <SchoolYearSwitcher years={years} currentYearId={currentYear.id} />
          )}
          {superAdmin && (
            <span className="hidden rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 sm:inline">
              Super admin
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white sm:flex">
              {user.fullName ? user.fullName.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() ?? "U"}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">{user.fullName ?? user.email}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
