"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUser,
  updateUser,
  resetPassword,
  toggleActive,
  importUsersCsv,
  type RoleInput,
} from "@/app/(app)/admin/utilisateurs/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import type { UserItem } from "@/app/(app)/admin/utilisateurs/page";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin_primaire: "Admin primaire",
  admin_secondaire: "Admin secondaire",
  enseignant: "Enseignant",
};

function rolePillClass(role: string) {
  if (role === "super_admin") return "bg-indigo-100 text-indigo-700";
  if (role === "admin_primaire") return "bg-blue-100 text-blue-700";
  if (role === "admin_secondaire") return "bg-green-100 text-green-700";
  return "bg-slate-100 text-slate-600";
}

type RoleRow = { role: string; section: "primaire" | "secondaire" | "" };

export function UsersManager({ users }: { users: UserItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserItem | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roles, setRoles] = useState<RoleRow[]>([{ role: "enseignant", section: "" }]);

  const stats = useMemo(() => {
    const teachers = users.filter((u) => u.roles.some((r) => r.role === "enseignant"));
    const admins = users.filter((u) =>
      ["admin_primaire", "admin_secondaire", "super_admin"].some((r) =>
        u.roles.some((x) => x.role === r)
      )
    );
    const active = users.filter((u) => !u.disabled);
    return { total: users.length, teachers: teachers.length, admins: admins.length, active: active.length };
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !(u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))) return false;
      if (roleFilter !== "all" && !u.roles.some((r) => r.role === roleFilter)) return false;
      if (sectionFilter !== "all" && !u.roles.some((r) => r.section === sectionFilter)) return false;
      return true;
    });
  }, [users, query, roleFilter, sectionFilter]);

  function openCreate() {
    setEditTarget(null);
    setName(""); setEmail(""); setPhone(""); setRoles([{ role: "enseignant", section: "" }]);
    setError(null); setTempPassword(null);
    setDialogOpen(true);
  }

  function openEdit(u: UserItem) {
    setEditTarget(u);
    setName(u.full_name); setEmail(u.email); setPhone(u.phone ?? "");
    setRoles(u.roles.map((r) => ({ role: r.role, section: (r.section as any) ?? "" })));
    setError(null); setTempPassword(null);
    setDialogOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    const roleInputs: RoleInput[] = roles
      .filter((r) => r.role)
      .map((r) => ({ role: r.role as any, section: r.section ? (r.section as any) : null }));

    const res = editTarget
      ? await updateUser({ userId: editTarget.id, full_name: name, phone, roles: roleInputs })
      : await createUser({ email, full_name: name, phone, roles: roleInputs });

    if (res.error) { setError(res.error); setBusy(false); return; }
    if (res.tempPassword) setTempPassword(res.tempPassword);
    else { setDialogOpen(false); setBusy(false); router.refresh(); }
  }

  async function handleReset(u: UserItem) {
    setBusy(true); setError(null);
    const res = await resetPassword(u.id);
    setBusy(false);
    if (res.error) setError(res.error);
    else if (res.tempPassword) setTempPassword(res.tempPassword);
  }

  async function handleToggle(u: UserItem) {
    await toggleActive(u.id, !u.disabled);
    router.refresh();
  }

  function addRoleRow() {
    setRoles((rs) => [...rs, { role: "enseignant", section: "" }]);
  }
  function updateRoleRow(i: number, patch: Partial<RoleRow>) {
    setRoles((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRoleRow(i: number) {
    setRoles((rs) => rs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Total</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{stats.total}</div>
          <div className="text-xs text-slate-400">Tous rôles</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Enseignants</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{stats.teachers}</div>
          <div className="text-xs text-slate-400">Avec rôle enseignant</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Administrateurs</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{stats.admins}</div>
          <div className="text-xs text-slate-400">Super + sections</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Comptes actifs</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {stats.active} <span className="text-base font-normal text-slate-400">/ {stats.total}</span>
          </div>
          <div className="text-xs text-slate-400">{stats.total - stats.active} désactivé(s)</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            placeholder="Rechercher un nom, un e-mail…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">Tous les rôles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={sectionFilter}
          onChange={(e) => setSectionFilter(e.target.value)}
        >
          <option value="all">Toutes les sections</option>
          <option value="primaire">Primaire</option>
          <option value="secondaire">Secondaire</option>
        </select>
        <Button onClick={openCreate}>
          <span className="mr-1">+</span> Nouvel utilisateur
        </Button>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" onClick={() => setCsvOpen(true)} />}>
            Importer (CSV)
          </TooltipTrigger>
          <TooltipContent>
            Colonnes attendues : email, nom, téléphone, rôle, section
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 whitespace-nowrap">Nom</th>
              <th className="px-4 py-3 whitespace-nowrap">E-mail</th>
              <th className="px-4 py-3 whitespace-nowrap">Téléphone</th>
              <th className="px-4 py-3 whitespace-nowrap">Rôles</th>
              <th className="px-4 py-3 whitespace-nowrap">Section</th>
              <th className="px-4 py-3 whitespace-nowrap">Actif</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{u.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-500">{u.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r, i) => (
                      <span key={i} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${rolePillClass(r.role)}`}>
                        {ROLE_LABELS[r.role] ?? r.role}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {u.roles.filter((r) => r.section).map((r) => r.section).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleToggle(u)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${u.disabled ? "bg-slate-300" : "bg-green-500"}`}
                    aria-label={u.disabled ? "Activer" : "Désactiver"}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${u.disabled ? "translate-x-0.5" : "translate-x-5"}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(u)}>Modifier</Button>
                    <Button variant="outline" size="sm" onClick={() => handleReset(u)}>Réinit. mdp</Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Aucun utilisateur trouvé</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</DialogTitle>
            <DialogDescription>
              {editTarget ? "Mettez à jour les informations et rôles." : "Créez un compte avec e-mail + mot de passe."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Nom complet</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Mbuyi Kabongo" />
            </div>
            {!editTarget && (
              <div>
                <Label>Adresse e-mail</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="prenom.nom@siloe.edu" />
              </div>
            )}
            <div>
              <Label>Téléphone (optionnel)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+243 …" />
            </div>

            <div>
              <Label>Rôle(s)</Label>
              <div className="space-y-2">
                {roles.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      value={r.role}
                      onChange={(e) => updateRoleRow(i, { role: e.target.value })}
                    >
                      <option value="enseignant">Enseignant</option>
                      <option value="admin_primaire">Admin primaire</option>
                      <option value="admin_secondaire">Admin secondaire</option>
                      <option value="super_admin">Super admin</option>
                    </select>
                    {r.role !== "super_admin" && (
                      <select
                        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                        value={r.section}
                        onChange={(e) => updateRoleRow(i, { section: e.target.value as any })}
                      >
                        <option value="">— Section —</option>
                        <option value="primaire">Primaire</option>
                        <option value="secondaire">Secondaire</option>
                      </select>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => removeRoleRow(i)}>✕</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addRoleRow}>+ Ajouter un rôle</Button>
              </div>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {tempPassword && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <strong>Mot de passe temporaire :</strong> <code>{tempPassword}</code>
                <div className="text-xs">À communiquer à l'utilisateur. Fermez la boîte pour continuer.</div>
                <Button size="sm" className="mt-2" onClick={() => { setTempPassword(null); setDialogOpen(false); router.refresh(); }}>
                  OK
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Enregistrement…" : editTarget ? "Enregistrer" : "Créer le compte"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Temp password modal for reset */}
      {tempPassword && !dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Mot de passe temporaire</h3>
            <p className="mt-1 text-sm text-slate-500">À communiquer à l'utilisateur.</p>
            <code className="mt-3 block rounded-md bg-slate-100 px-3 py-2 text-sm">{tempPassword}</code>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => { setTempPassword(null); router.refresh(); }}>OK</Button>
            </div>
          </div>
        </div>
      )}

      {csvOpen && (
        <CsvImportDialog
          entity="users"
          onOpenChange={setCsvOpen}
          onImported={() => router.refresh()}
          importAction={async (rows) => importUsersCsv(rows)}
          templateColumns={["email", "nom", "téléphone", "rôle", "section"]}
        />
      )}
    </div>
  );
}
