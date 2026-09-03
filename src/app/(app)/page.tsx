import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signOut } from "../actions";

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

export default async function Home() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const superAdmin = isSuperAdmin(user.roles);
  const adminPrim = isSectionAdmin(user.roles, "primaire");
  const adminSec = isSectionAdmin(user.roles, "secondaire");

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
