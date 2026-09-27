-- ============================================================
-- 0016_branch_classes.sql
-- Une branche SANS sous-branches peut être enseignée dans PLUSIEURS
-- classes (ex. EPS en 1ère, 2e et 3e) : 0015 n'autorisait qu'une classe
-- par colonne. Remplace donc branches.classe_id par une table de liaison,
-- alignée sur sous_branches (0014) : FK réelles, cascade à la suppression
-- d'une classe, RLS par rôle.
-- Les liaisons de 0015 sont reprises avant de supprimer la colonne.
-- ============================================================

create table public.branch_classes (
  branche_id uuid not null references public.branches(id) on delete cascade,
  classe_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (branche_id, classe_id)
);
create index idx_branch_classes_classe on public.branch_classes(classe_id);

-- Sans cette ligne les politiques ci-dessous sont inertes (leçon 0012).
alter table public.branch_classes enable row level security;

create policy "branch_classes_select"
  on public.branch_classes for select to authenticated
  using (true);

create policy "branch_classes_insert"
  on public.branch_classes for insert to authenticated
  with check (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "branch_classes_update"
  on public.branch_classes for update to authenticated
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'))
  with check (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "branch_classes_delete"
  on public.branch_classes for delete to authenticated
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

-- Reprise des liaisons mono-classe de 0015.
insert into public.branch_classes (branche_id, classe_id)
select b.id, b.classe_id
from public.branches b
where b.classe_id is not null
on conflict do nothing;

drop index if exists public.idx_branches_classe;
alter table public.branches drop column classe_id;
