import { cookies } from "next/headers";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { getActiveSchoolYear, listSchoolYears } from "@/lib/school-year";
import { SchoolYearSwitcher } from "@/components/school-year-switcher";
import { OfflineGuard } from "@/components/sync/offline-guard";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MainNav, MobileNav, type Sections } from "@/components/main-nav";
import { UserMenu } from "@/components/user-menu";
import { redirect } from "next/navigation";
import Link from "next/link";

const YEAR_COOKIE = "pm_year";

function roleLabel(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  const labels: Record<string, string> = {
    super_admin: "Super admin",
    admin_primaire: "Admin · Primaire",
    admin_secondaire: "Admin · Secondaire",
    enseignant: "Enseignant",
  };
  if (user.roles.length === 0) return "";
  return user.roles.map((r) => labels[r.role] ?? r.role).join(" · ");
}

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
  const adminSections: Sections = [
    ...(isSectionAdmin(user.roles, "primaire") ? ["primaire" as const] : []),
    ...(isSectionAdmin(user.roles, "secondaire") ? ["secondaire" as const] : []),
  ];
  const isAdmin = superAdmin || adminSections.length > 0;

  return (
    <div className="min-h-screen bg-slate-100">
      <OfflineGuard />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white print:hidden">
        <div className="flex h-14 items-center gap-1 px-3 sm:gap-2 sm:px-6">
          <MobileNav
            isAdmin={isAdmin}
            superAdmin={superAdmin}
            sections={adminSections}
          />
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-700 text-white text-sm font-extrabold">
              S
            </span>
            <span className="hidden text-sm font-bold text-slate-800 sm:inline">
              Prévisions Matières
            </span>
          </Link>
          <MainNav
            isAdmin={isAdmin}
            superAdmin={superAdmin}
            sections={adminSections}
          />
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
            <NotificationBell />
            <UserMenu
              fullName={user.fullName ?? user.email ?? ""}
              email={user.email ?? ""}
              rolesLabel={roleLabel(user)}
              initial={
                user.fullName
                  ? user.fullName.charAt(0).toUpperCase()
                  : user.email?.charAt(0).toUpperCase() ?? "U"
              }
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
