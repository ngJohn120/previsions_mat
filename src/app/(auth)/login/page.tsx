"use client";

import { login, type LoginState } from "./actions";
import { useActionState } from "react";

export default function LoginPage() {
  const initialState: LoginState = {};
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        {/* Brand */}
        <div className="px-8 pt-8 pb-6 text-center border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white text-2xl font-extrabold shadow-lg">
            S
          </div>
          <h1 className="text-xl font-bold text-slate-900">Prévisions Matières</h1>
          <p className="mt-1 text-xs text-slate-500">
            Complexe Scolaire SILOE · Gestion des prévisions annuelles
          </p>
        </div>

        <form action={formAction} className="px-8 py-6">
          {state?.error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              Adresse e-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="prenom.nom@siloe.edu"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div className="mb-5 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" className="rounded border-slate-300" /> Se souvenir de moi
            </label>
            <a href="#" className="font-medium text-blue-700 hover:underline">
              Mot de passe oublié ?
            </a>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {pending ? "Connexion…" : "Se connecter"}
          </button>

          <p className="mt-5 text-center text-xs text-slate-400">
            Accès réservé au personnel autorisé.
          </p>
        </form>
      </div>
    </main>
  );
}
