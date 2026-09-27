import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";

const YEAR_COOKIE = "pm_year";

function roleLabel(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  const labels: Record<string, string> = {
    super_admin: "Super administrateur",
    admin_primaire: "Administrateur · Primaire",
    admin_secondaire: "Administrateur · Secondaire",
    enseignant: "Enseignant",
  };
  if (user.roles.length === 0) return "—";
  return user.roles.map((r) => labels[r.role] ?? r.role).join(" · ");
}

/** Classes the signed-in teacher actually teaches, for the selected year
 *  (top-bar switcher cookie, else the active year). `null` for non-teachers. */
async function teacherClasses(
  userId: string,
  isTeacher: boolean
): Promise<string[] | null> {
  if (!isTeacher) return null;
  const supabase = await createClient();
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;
  const { data: years } = await supabase.from("school_years").select("id, status");
  const yearId =
    (years ?? []).find((y: { id: string }) => y.id === cookieYear)?.id ??
    (years ?? []).find((y: { status: string }) => y.status === "active")?.id ??
    (years ?? [])[0]?.id;
  if (!yearId) return [];
  const { data: attribs } = await supabase
    .from("attributions")
    .select("classe:classes(name)")
    .eq("school_year_id", yearId)
    .eq("enseignant_id", userId)
    .returns<{ classe: { name: string } | null }[]>();
  const names = (attribs ?? [])
    .map((a) => a.classe?.name)
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export default async function Home() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const superAdmin = isSuperAdmin(user.roles);
  const adminPrim = isSectionAdmin(user.roles, "primaire");
  const adminSec = isSectionAdmin(user.roles, "secondaire");
  const isTeacher = user.roles.some((r) => r.role === "enseignant");
  const classes = await teacherClasses(user.id, isTeacher);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-700 text-white text-xl font-extrabold">
          S
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          Prévisions Matières
        </h1>
        <p className="mt-1 text-sm text-slate-500">Complexe Scolaire SILOE</p>

        <div className="mt-6 space-y-2 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div>
            Connecté : <span className="font-semibold">{user.email}</span>
          </div>
          <div>
            Nom : <span className="font-semibold">{user.fullName ?? "—"}</span>
          </div>
          <div>
            Rôle : <span className="font-semibold">{roleLabel(user)}</span>
          </div>
          {classes && (
            <div>
              Classe{classes.length > 1 ? "s" : ""} :{" "}
              <span className="font-semibold">
                {classes.length ? classes.join(" · ") : "aucune classe attribuée"}
              </span>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 text-sm">
          {superAdmin && (
            <div className="rounded-md bg-indigo-50 px-3 py-2 text-indigo-700">
              Accès super admin — toutes les sections
            </div>
          )}
          {adminPrim && (
            <div className="rounded-md bg-blue-50 px-3 py-2 text-blue-700">
              Admin Primaire
            </div>
          )}
          {adminSec && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-green-700">
              Admin Secondaire
            </div>
          )}
          {!superAdmin && !adminPrim && !adminSec && (
            <div className="rounded-md bg-slate-100 px-3 py-2 text-slate-600">
              Espace enseignant (à venir)
            </div>
          )}
        </div>

        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
