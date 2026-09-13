-- 0012: section validation for yearly rollover (Révision page).
-- Each section admin validates their section's cloned structure for an
-- upcoming year; the super admin cannot activate until both sections are
-- validated (guarded in activateYear, this table holds the evidence).
create table if not exists public.year_section_validations (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  section text not null check (section in ('primaire', 'secondaire')),
  validated_by uuid not null,
  validated_at timestamptz not null default now(),
  unique (school_year_id, section)
);

-- Critical: without RLS enabled the policies below are inert and any
-- authenticated user could read/modify validations.
alter table public.year_section_validations enable row level security;

-- Section admins see only their section's validations; super admin sees all.
create policy "year_section_validations_select"
  on public.year_section_validations
  for select
  to authenticated
  using (public.is_super_admin() or public.is_section_admin(section));

-- Only the section admin of the section being validated may create the row.
create policy "year_section_validations_insert"
  on public.year_section_validations
  for insert
  to authenticated
  with check (public.is_section_admin(section));

-- Re-validation (upsert after a previous row exists) by the section's admin.
create policy "year_section_validations_update"
  on public.year_section_validations
  for update
  to authenticated
  using (public.is_section_admin(section))
  with check (public.is_section_admin(section));

-- Revocation: the author (still a section admin of that section) or super admin.
create policy "year_section_validations_delete"
  on public.year_section_validations
  for delete
  to authenticated
  using (
    public.is_super_admin()
    or (public.is_section_admin(section) and validated_by = auth.uid())
  );