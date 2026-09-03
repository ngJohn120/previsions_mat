import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { signOut } from "./actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-700 text-white text-xl font-extrabold">
          S
        </div>
        <h1 className="text-2xl font-bold text-slate-900">
          Prévisions Matières
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Complexe Scolaire SILOE
        </p>
        <div className="mt-6 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Connecté en tant que{" "}
          <span className="font-semibold">{user.email}</span>
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
