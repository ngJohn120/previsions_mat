-- 0010: fix INSERT ... RETURNING RLS failure for section admins.
--
-- createAttribution inserts attributions / fiches / fiche_rows with
-- .select("id") (RETURNING). During INSERT..RETURNING, a SELECT policy that
-- re-queries the same table by id cannot see the new row (statement
-- snapshot), so the policy evaluates false and PostgREST returns 42501 for
-- section admins; super admin short-circuits via is_super_admin(), which is
-- why it only failed for section-admin accounts.
--
-- Fix: SELECT/INSERT/UPDATE/DELETE judges are now row-local — they evaluate
-- the row's own columns and join OTHER tables only, never re-querying the
-- table being written by id. Equivalent for existing rows, and also true
-- for the new row during RETURNING.
--
-- fiche_cells is intentionally untouched: its policies judge via
-- fiche_rows (a different table, already committed when cells are written),
-- which is snapshot-safe.

-- ============ attributions ============
create or replace function public.can_access_attribution(p_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.attributions a
      join public.classes c on c.id = a.classe_id
      where a.id = p_id
        and public.is_section_admin(c.section)
    )
    or exists (
      select 1 from public.attributions a
      where a.id = p_id
        and a.enseignant_id = auth.uid()
    );
$$;

-- row-local judge: same rules, evaluated from the row's own column values.
create or replace function public.can_access_attribution_row(
  p_classe_id uuid,
  p_enseignant_id uuid
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.classes c
      where c.id = p_classe_id
        and public.is_section_admin(c.section)
    )
    or p_enseignant_id = auth.uid();
$$;

drop policy if exists "attributions_select_access" on public.attributions;
create policy "attributions_select_access"
  on public.attributions for select
  using (public.can_access_attribution_row(classe_id, enseignant_id));

drop policy if exists "attributions_insert_section_admin" on public.attributions;
create policy "attributions_insert_section_admin"
  on public.attributions for insert
  with check (public.can_access_attribution_row(classe_id, enseignant_id));

drop policy if exists "attributions_update_section_admin" on public.attributions;
create policy "attributions_update_section_admin"
  on public.attributions for update
  using (public.can_access_attribution_row(classe_id, enseignant_id));

drop policy if exists "attributions_delete_section_admin" on public.attributions;
create policy "attributions_delete_section_admin"
  on public.attributions for delete
  using (public.can_access_attribution_row(classe_id, enseignant_id));

-- ============ fiches ============
create or replace function public.can_access_fiche(p_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.fiches f
      join public.attributions a on a.id = f.attribution_id
      join public.classes c on c.id = a.classe_id
      where f.id = p_id
        and public.is_section_admin(c.section)
    )
    or exists (
      select 1 from public.fiches f
      join public.attributions a on a.id = f.attribution_id
      where f.id = p_id
        and a.enseignant_id = auth.uid()
    );
$$;

-- row-local judge for fiches: judged via the attribution (and its class)
-- referenced by the row's own attribution_id, plus direct teacher ownership.
create or replace function public.can_access_fiche_values(
  p_attribution_id uuid
)
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

drop policy if exists "fiches_select_access" on public.fiches;
create policy "fiches_select_access"
  on public.fiches for select
  using (public.can_access_fiche_values(attribution_id));

drop policy if exists "fiches_insert_access" on public.fiches;
create policy "fiches_insert_access"
  on public.fiches for insert
  with check (public.can_access_fiche_values(attribution_id));

drop policy if exists "fiches_update_own_draft" on public.fiches;
create policy "fiches_update_own_draft"
  on public.fiches for update
  using (
    exists (
      select 1 from public.attributions a
      where a.id = attribution_id and a.enseignant_id = auth.uid()
    )
    and statut = 'brouillon'
  );

drop policy if exists "fiches_update_admin" on public.fiches;
create policy "fiches_update_admin"
  on public.fiches for update
  using (public.can_access_fiche_values(attribution_id) and (public.is_super_admin() or public.is_section_admin('primaire') or public.is_section_admin('secondaire')));

-- ============ fiche_rows (inherit fiche access) ============
create or replace function public.can_access_fiche_row(p_row_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.fiche_rows fr
    where fr.id = p_row_id and public.can_access_fiche(fr.fiche_id)
  );
$$;

-- row-local judge: takes the row's own fiche_id value directly.
create or replace function public.can_access_fiche_row_by_fiche(
  p_fiche_id uuid
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.can_access_fiche_values(p_fiche_id);
$$;

drop policy if exists "fiche_rows_select_access" on public.fiche_rows;
create policy "fiche_rows_select_access"
  on public.fiche_rows for select
  using (public.can_access_fiche_row_by_fiche(fiche_id));

drop policy if exists "fiche_rows_insert_access" on public.fiche_rows;
create policy "fiche_rows_insert_access"
  on public.fiche_rows for insert
  with check (public.can_access_fiche_row_by_fiche(fiche_id));

drop policy if exists "fiche_rows_update_access" on public.fiche_rows;
create policy "fiche_rows_update_access"
  on public.fiche_rows for update
  using (public.can_access_fiche_row_by_fiche(fiche_id));

drop policy if exists "fiche_rows_delete_access" on public.fiche_rows;
create policy "fiche_rows_delete_access"
  on public.fiche_rows for delete
  using (public.can_access_fiche_row_by_fiche(fiche_id));
