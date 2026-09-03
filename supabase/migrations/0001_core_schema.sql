-- ============================================================
-- Prévisions Matières — 0001_core_schema.sql
-- Core schema: profiles, user_roles, school_years, sections,
-- classes, branches, sous_branches, attributions, fiches,
-- fiche_rows, fiche_cells, unlock_requests, activity_log,
-- template_versions (RLS added in 0002)
-- ============================================================

-- ---------- updated_at trigger helper ----------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles (extends auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ---------- user_roles ----------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin_primaire', 'admin_secondaire', 'enseignant')),
  -- section is nullable: only meaningful for section-bound roles
  section text check (section in ('primaire', 'secondaire')),
  unique (user_id, role, section)
);
create index idx_user_roles_user on public.user_roles(user_id);

-- ---------- school_years ----------
create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_school_years_updated_at
  before update on public.school_years
  for each row execute function public.handle_updated_at();

-- ---------- sections ----------
create table public.sections (
  id text primary key check (id in ('primaire', 'secondaire')),
  name text not null
);
insert into public.sections (id, name) values
  ('primaire', 'Primaire'),
  ('secondaire', 'Secondaire');

-- ---------- classes ----------
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  section text not null references public.sections(id),
  name text not null,              -- e.g. '6e B'
  level text not null,             -- e.g. '6e'
  ordre int not null default 0,
  titulaire_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year_id, section, name)
);
create index idx_classes_year on public.classes(school_year_id);
create index idx_classes_section on public.classes(section);
create trigger trg_classes_updated_at
  before update on public.classes
  for each row execute function public.handle_updated_at();

-- ---------- branches (shared catalogue) ----------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sections text[] not null default '{}' check (sections <@ array['primaire','secondaire']),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_branches_updated_at
  before update on public.branches
  for each row execute function public.handle_updated_at();

-- ---------- sous_branches ----------
create table public.sous_branches (
  id uuid primary key default gen_random_uuid(),
  branche_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (branche_id, name)
);
create index idx_sous_branches_branche on public.sous_branches(branche_id);

-- ---------- attributions ----------
create table public.attributions (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  classe_id uuid not null references public.classes(id) on delete cascade,
  branche_id uuid not null references public.branches(id) on delete restrict,
  sous_branche_id uuid references public.sous_branches(id) on delete set null,
  enseignant_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year_id, classe_id, branche_id, sous_branche_id)
);
create index idx_attributions_year on public.attributions(school_year_id);
create index idx_attributions_enseignant on public.attributions(enseignant_id);
create trigger trg_attributions_updated_at
  before update on public.attributions
  for each row execute function public.handle_updated_at();

-- ---------- fiches (one per attribution) ----------
create table public.fiches (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references public.attributions(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'soumise')),
  version int not null default 1,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attribution_id)
);
create index idx_fiches_year on public.fiches(school_year_id);
create trigger trg_fiches_updated_at
  before update on public.fiches
  for each row execute function public.handle_updated_at();

-- ---------- fiche_rows (template rows copied per fiche) ----------
create table public.fiche_rows (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references public.fiches(id) on delete cascade,
  row_uuid uuid not null,            -- stable uuid across template versions / sync
  ordre int not null,
  row_type text not null default 'enseignement' check (row_type in ('enseignement', 'evenement')),
  mois text,                          -- 'Septembre', etc. (primaire)
  semaine_num int,                    -- 1..N
  date_label text,                    -- '01 → 04/09/2026'
  periode_label text,                 -- '1re période', or for events: 'Vacances de Noël', etc.
  evenement_label text,               -- event type label for display
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiche_id, row_uuid)
);
create index idx_fiche_rows_fiche on public.fiche_rows(fiche_id);
create trigger trg_fiche_rows_updated_at
  before update on public.fiche_rows
  for each row execute function public.handle_updated_at();

-- ---------- fiche_cells (content per row/column) ----------
create table public.fiche_cells (
  id uuid primary key default gen_random_uuid(),
  fiche_row_id uuid not null references public.fiche_rows(id) on delete cascade,
  col_key text not null,              -- 'matieres','ref','intention','obs','heure','mv', ...
  value text not null default '',
  version int not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (fiche_row_id, col_key)
);
create index idx_fiche_cells_row on public.fiche_cells(fiche_row_id);
create trigger trg_fiche_cells_updated_at
  before update on public.fiche_cells
  for each row execute function public.handle_updated_at();

-- ---------- unlock_requests ----------
create table public.unlock_requests (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references public.fiches(id) on delete cascade,
  demandeur_id uuid not null references auth.users(id) on delete cascade,
  motif text not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'approuvee', 'refusee')),
  traite_par uuid references auth.users(id) on delete set null,
  traite_le timestamptz,
  created_at timestamptz not null default now()
);
create index idx_unlock_requests_fiche on public.unlock_requests(fiche_id);
create index idx_unlock_requests_statut on public.unlock_requests(statut);

-- ---------- activity_log ----------
create table public.activity_log (
  id bigint generated always as identity primary key,
  fiche_id uuid references public.fiches(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_log_fiche on public.activity_log(fiche_id);
create index idx_activity_log_created on public.activity_log(created_at desc);

-- ---------- template_versions ----------
create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  section text not null references public.sections(id),
  version int not null,
  is_active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year_id, section, version)
);
create index idx_template_versions_year_section on public.template_versions(school_year_id, section);
create trigger trg_template_versions_updated_at
  before update on public.template_versions
  for each row execute function public.handle_updated_at();
