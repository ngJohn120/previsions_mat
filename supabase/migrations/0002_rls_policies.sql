-- ============================================================
-- Prévisions Matières — 0002_rls_policies.sql
-- Authorization helpers + RLS policies
-- ============================================================

-- ---------- Helper: super admin ----------
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

-- ---------- Helper: section admin of a given section ----------
create or replace function public.is_section_admin(p_section text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin_' || p_section
  );
$$;

-- ---------- Helper: is teacher (has enseignant role) ----------
create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'enseignant'
  );
$$;

-- ---------- Helper: user's section scope ----------
-- Returns array of sections the current user may administer/see.
-- super_admin => both; section admin => own; teacher => null (handled by ownership)
create or replace function public.user_sections()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(ur.section), '{}')
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.section is not null;
$$;

-- ---------- Enable RLS ----------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.school_years enable row level security;
alter table public.sections enable row level security;
alter table public.classes enable row level security;
alter table public.branches enable row level security;
alter table public.sous_branches enable row level security;
alter table public.attributions enable row level security;
alter table public.fiches enable row level security;
alter table public.fiche_rows enable row level security;
alter table public.fiche_cells enable row level security;
alter table public.unlock_requests enable row level security;
alter table public.activity_log enable row level security;
alter table public.template_versions enable row level security;

-- ---------- profiles ----------
-- Users can read/update their own profile; super admins manage all.
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "profiles_insert_admin"
  on public.profiles for insert
  with check (public.is_super_admin());

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_super_admin());

-- ---------- user_roles ----------
create policy "user_roles_select_self_or_admin"
  on public.user_roles for select
  using (user_id = auth.uid() or public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "user_roles_write_admin"
  on public.user_roles for insert
  with check (public.is_super_admin());

create policy "user_roles_update_admin"
  on public.user_roles for update
  using (public.is_super_admin());

create policy "user_roles_delete_admin"
  on public.user_roles for delete
  using (public.is_super_admin());

-- ---------- school_years ----------
-- Visible to all authenticated users; only super admin can write.
create policy "school_years_select_auth"
  on public.school_years for select
  to authenticated
  using (true);

create policy "school_years_insert_admin"
  on public.school_years for insert
  with check (public.is_super_admin());

create policy "school_years_update_admin"
  on public.school_years for update
  using (public.is_super_admin());

-- ---------- sections ----------
create policy "sections_select_auth"
  on public.sections for select
  to authenticated
  using (true);

-- ---------- classes ----------
-- Section admins manage classes in their section; super admin all; teachers read.
create policy "classes_select_auth"
  on public.classes for select
  to authenticated
  using (true);

create policy "classes_insert_section_admin"
  on public.classes for insert
  with check (
    public.is_super_admin()
    or (public.is_section_admin(section))
  );

create policy "classes_update_section_admin"
  on public.classes for update
  using (
    public.is_super_admin()
    or public.is_section_admin(section)
  );

create policy "classes_delete_section_admin"
  on public.classes for delete
  using (
    public.is_super_admin()
    or public.is_section_admin(section)
  );

-- ---------- branches / sous_branches (shared catalogue) ----------
create policy "branches_select_auth"
  on public.branches for select
  to authenticated
  using (true);

create policy "branches_insert_super"
  on public.branches for insert
  with check (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "branches_update_super"
  on public.branches for update
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "branches_delete_super"
  on public.branches for delete
  using (public.is_super_admin());

create policy "sous_branches_select_auth"
  on public.sous_branches for select
  to authenticated
  using (true);

create policy "sous_branches_insert_admin"
  on public.sous_branches for insert
  with check (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "sous_branches_update_admin"
  on public.sous_branches for update
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "sous_branches_delete_admin"
  on public.sous_branches for delete
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

-- ---------- attributions ----------
-- Teachers see only their own; section admins see their section; super all.
create or replace function public.can_access_attribution(p_attribution_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.attributions a
      join public.classes c on c.id = a.classe_id
      where a.id = p_attribution_id
        and public.is_section_admin(c.section)
    )
    or exists (
      select 1 from public.attributions a
      where a.id = p_attribution_id
        and a.enseignant_id = auth.uid()
    );
$$;

create policy "attributions_select_access"
  on public.attributions for select
  using (public.can_access_attribution(id));

create policy "attributions_insert_section_admin"
  on public.attributions for insert
  with check (
    public.is_super_admin()
    or (
      exists (
        select 1 from public.classes c
        where c.id = classe_id and public.is_section_admin(c.section)
      )
    )
  );

create policy "attributions_update_section_admin"
  on public.attributions for update
  using (
    public.is_super_admin()
    or (
      exists (
        select 1 from public.classes c
        where c.id = classe_id and public.is_section_admin(c.section)
      )
    )
  );

create policy "attributions_delete_section_admin"
  on public.attributions for delete
  using (
    public.is_super_admin()
    or (
      exists (
        select 1 from public.classes c
        where c.id = classe_id and public.is_section_admin(c.section)
      )
    )
  );

-- ---------- fiches ----------
-- Teacher access via attribution ownership; admin via class section.
create or replace function public.can_access_fiche(p_fiche_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.fiches f
      join public.attributions a on a.id = f.attribution_id
      join public.classes c on c.id = a.classe_id
      where f.id = p_fiche_id
        and public.is_section_admin(c.section)
    )
    or exists (
      select 1 from public.fiches f
      join public.attributions a on a.id = f.attribution_id
      where f.id = p_fiche_id
        and a.enseignant_id = auth.uid()
    );
$$;

create policy "fiches_select_access"
  on public.fiches for select
  using (public.can_access_fiche(id));

create policy "fiches_insert_access"
  on public.fiches for insert
  with check (public.can_access_fiche(id));

create policy "fiches_update_own_draft"
  on public.fiches for update
  using (
    -- teachers may update only their own draft fiches
    exists (
      select 1 from public.attributions a
      where a.id = attribution_id and a.enseignant_id = auth.uid()
    )
    and statut = 'brouillon'
  );

create policy "fiches_update_admin"
  on public.fiches for update
  using (public.can_access_fiche(id) and (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire')));

-- ---------- fiche_rows / fiche_cells (inherit fiche access) ----------
create or replace function public.can_access_fiche_row(p_row_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.fiche_rows fr
    where fr.id = p_row_id and public.can_access_fiche(fr.fiche_id)
  );
$$;

create policy "fiche_rows_select_access"
  on public.fiche_rows for select
  using (public.can_access_fiche_row(id));

create policy "fiche_rows_insert_access"
  on public.fiche_rows for insert
  with check (public.can_access_fiche_row(id));

create policy "fiche_rows_update_access"
  on public.fiche_rows for update
  using (public.can_access_fiche_row(id));

create policy "fiche_rows_delete_access"
  on public.fiche_rows for delete
  using (public.can_access_fiche_row(id));

create policy "fiche_cells_select_access"
  on public.fiche_cells for select
  using (public.can_access_fiche_row(fiche_row_id));

create policy "fiche_cells_insert_access"
  on public.fiche_cells for insert
  with check (public.can_access_fiche_row(fiche_row_id));

create policy "fiche_cells_update_access"
  on public.fiche_cells for update
  using (public.can_access_fiche_row(fiche_row_id));

create policy "fiche_cells_delete_access"
  on public.fiche_cells for delete
  using (public.can_access_fiche_row(fiche_row_id));

-- ---------- unlock_requests ----------
create policy "unlock_requests_select_access"
  on public.unlock_requests for select
  using (
    public.is_super_admin()
    or demandeur_id = auth.uid()
    or public.is_section_admin('primaire')
    or public.is_section_admin('secondaire')
  );

create policy "unlock_requests_insert_owner"
  on public.unlock_requests for insert
  with check (demandeur_id = auth.uid());

create policy "unlock_requests_update_admin"
  on public.unlock_requests for update
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

-- ---------- activity_log ----------
create policy "activity_log_select_admin"
  on public.activity_log for select
  using (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire'));

create policy "activity_log_insert_system"
  on public.activity_log for insert
  with check (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire') or auth.uid() = actor_id);

-- ---------- template_versions ----------
create policy "template_versions_select_auth"
  on public.template_versions for select
  to authenticated
  using (true);

create policy "template_versions_insert_super"
  on public.template_versions for insert
  with check (public.is_super_admin());

create policy "template_versions_update_super"
  on public.template_versions for update
  using (public.is_super_admin());

create policy "template_versions_delete_super"
  on public.template_versions for delete
  using (public.is_super_admin());
