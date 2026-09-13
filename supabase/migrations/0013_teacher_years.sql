-- 0013: per-year teacher roster. Who teaches in which year+section.
-- Roster membership only — login rights and roles stay global (user_roles).
create table public.teacher_years (
  user_id uuid not null references auth.users(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  section text not null check (section in ('primaire', 'secondaire')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, school_year_id, section)
);
create index idx_teacher_years_year on public.teacher_years(school_year_id);

create trigger trg_teacher_years_updated_at
  before update on public.teacher_years
  for each row execute function public.handle_updated_at();

-- Without this line the policies below are inert (0012 lesson).
alter table public.teacher_years enable row level security;

create policy "teacher_years_select"
  on public.teacher_years for select to authenticated
  using (public.is_super_admin() or public.is_section_admin(section));

create policy "teacher_years_insert"
  on public.teacher_years for insert to authenticated
  with check (public.is_super_admin() or public.is_section_admin(section));

create policy "teacher_years_update"
  on public.teacher_years for update to authenticated
  using (public.is_super_admin() or public.is_section_admin(section))
  with check (public.is_super_admin() or public.is_section_admin(section));

-- Backfill: every current enseignant role row × every existing year, active.
insert into public.teacher_years (user_id, school_year_id, section, is_active)
select r.user_id, y.id, r.section, true
from public.user_roles r
join public.school_years y on true
where r.role = 'enseignant' and r.section in ('primaire', 'secondaire')
on conflict do nothing;
