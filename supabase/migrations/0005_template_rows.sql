-- ============================================================
-- Prévisions Matières — 0005_template_rows.sql
-- Add template_rows (ordered row definition for a template version)
-- ============================================================

create table public.template_rows (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_versions(id) on delete cascade,
  row_uuid uuid not null,
  ordre int not null,
  row_type text not null default 'enseignement' check (row_type in ('enseignement', 'evenement')),
  mois text,                          -- 'Septembre', etc. (primaire display grouping)
  semaine_num int,                    -- 1..N (null for event bands)
  date_label text,                    -- '01 → 04/09/2026' (null for events)
  periode_label text,                 -- '1re période' or event label 'Vacances de Noël'
  evenement_label text,               -- event type (evaluation/examen/revision/vacances/detente) for display color
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, row_uuid)
);
create index idx_template_rows_version on public.template_rows(template_version_id);

alter table public.template_rows enable row level security;

-- Visible to all authenticated (like template_versions); writes super admin only
create policy "template_rows_select_auth"
  on public.template_rows for select
  to authenticated
  using (true);

create policy "template_rows_insert_super"
  on public.template_rows for insert
  with check (public.is_super_admin());

create policy "template_rows_update_super"
  on public.template_rows for update
  using (public.is_super_admin());

create policy "template_rows_delete_super"
  on public.template_rows for delete
  using (public.is_super_admin());
