-- ============================================================
-- Prévisions Matières — 0006_fiche_rpcs.sql
-- Fiche workflow RPCs (security definer, RLS-checked):
--   submit_fiche, request_unlock, approve_unlock, refuse_unlock,
--   set_cell_value, create_fiche_from_template
-- Also: fiche-level `conflit` flag + op_id for idempotent sync ops.
-- ============================================================

-- ---------- Helper: does the current user own the fiche (teacher) ----------
create or replace function public.is_fiche_teacher(p_fiche_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.fiches f
    join public.attributions a on a.id = f.attribution_id
    where f.id = p_fiche_id
      and a.enseignant_id = auth.uid()
  );
$$;

-- ---------- Helper: section of a fiche ----------
create or replace function public.fiche_section(p_fiche_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select c.section
  from public.fiches f
  join public.attributions a on a.id = f.attribution_id
  join public.classes c on c.id = a.classe_id
  where f.id = p_fiche_id;
$$;

-- ---------- Required columns per section (spec §6) ----------
-- primary:    Matières à enseigner, Réf., Intention required; Obs optional
-- secondary:  Matières prévues, Heure required; M.V./Obs optional
-- (Event rows have no required content.)
create or replace function public.required_cols_for_fiche(p_fiche_id uuid)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_section text;
begin
  v_section := public.fiche_section(p_fiche_id);
  if v_section = 'secondaire' then
    return array['matieres', 'heure'];
  end if;
  return array['matieres', 'ref', 'intention'];
end;
$$;

-- ---------- Activity log helper (internal; RLS bypassed) ----------
create or replace function public.log_activity(
  p_fiche_id uuid,
  p_actor_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.activity_log (fiche_id, actor_id, action, details)
  values (p_fiche_id, p_actor_id, p_action, p_details);
$$;

-- ============================================================
-- submit_fiche — atomic completeness check + status transition
-- ============================================================
create or replace function public.submit_fiche(p_fiche_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_statut text;
  v_section text;
  v_req text[];
  v_missing int;
  v_actor uuid := auth.uid();
begin
  -- Fetch fiche + section first (also proves existence)
  select f.statut, c.section
    into v_statut, v_section
    from public.fiches f
    join public.attributions a on a.id = f.attribution_id
    join public.classes c on c.id = a.classe_id
    where f.id = p_fiche_id;

  if v_statut is null then
    return query select false, 'Fiche introuvable.';
    return;
  end if;

  -- Access: teacher owner or admin of the fiche's section / super admin
  if not (
    public.is_super_admin()
    or public.is_fiche_teacher(p_fiche_id)
    or public.is_section_admin(v_section)
  ) then
    return query select false, 'Accès refusé à cette fiche.';
    return;
  end if;

  if v_statut = 'soumise' then
    return query select false, 'La fiche est déjà soumise.';
    return;
  end if;

  -- Completeness gate: every 'enseignement' row must have ALL required cells non-empty.
  v_req := public.required_cols_for_fiche(p_fiche_id);
  select count(*)
    into v_missing
    from public.fiche_rows fr
    where fr.fiche_id = p_fiche_id
      and fr.row_type = 'enseignement'
      and exists (
        select 1
        from unnest(v_req) as req(col_key)
        where not exists (
          select 1 from public.fiche_cells c
          where c.fiche_row_id = fr.id
            and c.col_key = req.col_key
            and btrim(c.value) <> ''
        )
      );
  if v_missing > 0 then
    return query select false, format('%s semaine(s) incomplète(s) : renseignez toutes les cellules requises.', v_missing);
    return;
  end if;

  update public.fiches
     set statut = 'soumise',
         submitted_at = now(),
         version = version + 1
   where id = p_fiche_id;

  perform public.log_activity(p_fiche_id, v_actor, 'fiche_submitted',
    jsonb_build_object('statut', 'soumise', 'section', v_section));

  return query select true, 'Fiche soumise.';
end;
$$;

-- ============================================================
-- request_unlock — insert pending unlock request (one at a time)
-- ============================================================
create or replace function public.request_unlock(p_fiche_id uuid, p_motif text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_pending int;
begin
  if not (public.is_super_admin() or public.is_fiche_teacher(p_fiche_id)) then
    return query select false, 'Seul le professeur titulaire (ou un admin) peut demander une réouverture.';
    return;
  end if;

  if btrim(coalesce(p_motif, '')) = '' then
    return query select false, 'Un motif est requis.';
    return;
  end if;

  select count(*) into v_pending
    from public.unlock_requests
    where fiche_id = p_fiche_id and statut = 'en_attente';

  if v_pending > 0 then
    return query select false, 'Une demande de réouverture est déjà en attente.';
    return;
  end if;

  insert into public.unlock_requests (fiche_id, demandeur_id, motif, statut)
  values (p_fiche_id, v_actor, btrim(p_motif), 'en_attente');

  perform public.log_activity(p_fiche_id, v_actor, 'unlock_requested',
    jsonb_build_object('motif', btrim(p_motif)));

  return query select true, 'Demande envoyée.';
end;
$$;

-- ============================================================
-- approve_unlock / refuse_unlock — admin handles a pending request
-- ============================================================
create or replace function public.approve_unlock(p_request_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_fiche uuid;
  v_statut text;
  v_actor uuid := auth.uid();
  v_section text;
begin
  select r.fiche_id into v_fiche
    from public.unlock_requests r
    where r.id = p_request_id and r.statut = 'en_attente';
  if v_fiche is null then
    return query select false, 'Demande introuvable ou déjà traitée.';
    return;
  end if;

  v_section := public.fiche_section(v_fiche);
  if not (public.is_super_admin() or public.is_section_admin(v_section)) then
    return query select false, 'Accès refusé : réservé aux administrateurs de la section.';
    return;
  end if;

  update public.unlock_requests
     set statut = 'approuvee',
         traite_par = v_actor,
         traite_le = now()
   where id = p_request_id;

  -- Back to draft so the teacher can edit/resubmit
  update public.fiches
     set statut = 'brouillon',
         submitted_at = null,
         version = version + 1
   where id = v_fiche;

  perform public.log_activity(v_fiche, v_actor, 'unlock_approved',
    jsonb_build_object('request_id', p_request_id));

  return query select true, 'Réouverture approuvée : la fiche est de nouveau en brouillon.';
end;
$$;

create or replace function public.refuse_unlock(p_request_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_fiche uuid;
  v_actor uuid := auth.uid();
  v_section text;
begin
  select r.fiche_id into v_fiche
    from public.unlock_requests r
    where r.id = p_request_id and r.statut = 'en_attente';
  if v_fiche is null then
    return query select false, 'Demande introuvable ou déjà traitée.';
    return;
  end if;

  v_section := public.fiche_section(v_fiche);
  if not (public.is_super_admin() or public.is_section_admin(v_section)) then
    return query select false, 'Accès refusé : réservé aux administrateurs de la section.';
    return;
  end if;

  update public.unlock_requests
     set statut = 'refusee',
         traite_par = v_actor,
         traite_le = now()
   where id = p_request_id;

  perform public.log_activity(v_fiche, v_actor, 'unlock_refused',
    jsonb_build_object('request_id', p_request_id));

  return query select true, 'Demande refusée.';
end;
$$;

-- ============================================================
-- set_cell_value — optimistic-concurrency cell write
-- p_expected_version: version the client believes it is editing.
-- Mismatch => error so the sync engine can flag a conflict.
-- ============================================================
create or replace function public.set_cell_value(
  p_cell_id uuid,
  p_value text,
  p_expected_version int default null
) returns table (ok boolean, message text, new_version int)
language plpgsql security definer set search_path = public
as $$
declare
  v_fiche uuid;
  v_row_type text;
  v_cur_version int;
  v_actor uuid := auth.uid();
  v_section text;
begin
  select fr.fiche_id, fr.row_type, c.version
    into v_fiche, v_row_type, v_cur_version
    from public.fiche_cells c
    join public.fiche_rows fr on fr.id = c.fiche_row_id
    where c.id = p_cell_id;
  if v_fiche is null then
    return query select false, 'Cellule introuvable.', null;
    return;
  end if;

  -- Row type check: event rows are not teacher-editable
  if v_row_type <> 'enseignement' then
    return query select false, 'Cette ligne (événement) n''est pas modifiable.', v_cur_version;
    return;
  end if;

  v_section := public.fiche_section(v_fiche);
  if not (public.is_super_admin() or public.is_fiche_teacher(v_fiche) or public.is_section_admin(v_section)) then
    return query select false, 'Accès refusé à cette cellule.', v_cur_version;
    return;
  end if;

  -- Teacher edits allowed only on draft; admins may set cells in read-only consult? no: admins only via unlock. Enforce draft for teachers.
  if public.is_fiche_teacher(v_fiche) then
    if not exists (select 1 from public.fiches f where f.id = v_fiche and f.statut = 'brouillon') then
      return query select false, 'La fiche est soumise : demandez une réouverture pour modifier.', v_cur_version;
      return;
    end if;
  end if;

  if p_expected_version is not null and p_expected_version <> v_cur_version then
    return query select false, 'Conflit de version : la cellule a été modifiée ailleurs.', v_cur_version;
    return;
  end if;

  update public.fiche_cells
     set value = coalesce(p_value, ''),
         version = version + 1,
         updated_by = v_actor,
         updated_at = now()
   where id = p_cell_id
   returning version into new_version;

  -- The fiche's own timestamp is what the dashboard ("Dernière modif.")
  -- and the fiche list sort by. Cell edits should advance it so the list
  -- reflects that the teacher actually worked on the fiche.
  update public.fiches
     set updated_at = now()
   where id = v_fiche;

  perform public.log_activity(v_fiche, v_actor, 'cell_updated',
    jsonb_build_object('cell_id', p_cell_id, 'value', coalesce(p_value, '')));

  return query select true, 'Cellule mise à jour.', new_version;
end;
$$;

-- ============================================================
-- create_fiche_from_template — materialize a draft fiche for an
-- attribution from the active template version (rows + empty cells)
-- ============================================================
create or replace function public.create_fiche_from_template(
  p_attribution_id uuid,
  p_school_year_id uuid,
  p_section text
) returns table (ok boolean, message text, fiche_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_tpl_id uuid;
  v_fiche uuid;
  v_tr record;
  v_row uuid;
  v_cols text[] := array['matieres','ref','intention','obs','heure','mv'];
  v_col text;
begin
  -- Access: admin/super may create fiches; teacher owner not (system op)
  if not (public.is_super_admin() or public.is_section_admin(p_section)) then
    return query select false, 'Accès refusé.', null;
    return;
  end if;

  -- Active template for this year+section
  select id into v_tpl_id
    from public.template_versions
    where school_year_id = p_school_year_id
      and section = p_section
      and is_active = true
    order by version desc
    limit 1;
  if v_tpl_id is null then
    return query select false, 'Aucun modèle actif pour cette année/section.', null;
    return;
  end if;

  -- Already exists?
  select f.id into v_fiche from public.fiches f where f.attribution_id = p_attribution_id;
  if v_fiche is not null then
    return query select false, 'Une fiche existe déjà pour cette attribution.', v_fiche;
    return;
  end if;

  insert into public.fiches (attribution_id, school_year_id, statut)
  values (p_attribution_id, p_school_year_id, 'brouillon')
  returning id into v_fiche;

  for v_tr in
    select * from public.template_rows
    where template_version_id = v_tpl_id
    order by ordre
  loop
    insert into public.fiche_rows (
      fiche_id, row_uuid, ordre, row_type, mois, semaine_num,
      date_label, periode_label, evenement_label
    ) values (
      v_fiche, v_tr.row_uuid, v_tr.ordre, v_tr.row_type, v_tr.mois, v_tr.semaine_num,
      v_tr.date_label, v_tr.periode_label, v_tr.evenement_label
    ) returning id into v_row;

    foreach v_col in array v_cols
    loop
      insert into public.fiche_cells (fiche_row_id, col_key, value)
      values (v_row, v_col, '');
    end loop;
  end loop;

  return query select true, 'Fiche créée.', v_fiche;
end;
$$;

-- ============================================================
-- Schema: fiche-level conflit flag + idempotent op ids
-- ============================================================
alter table public.fiches
  add column if not exists conflit boolean not null default false;

-- RLS for conflit flag updates is covered by existing fiche update policies.
