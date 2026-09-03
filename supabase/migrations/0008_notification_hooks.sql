-- ============================================================
-- Prévisions Matières — 0008_notification_hooks.sql
-- Wire notification inserts into the fiche workflow RPCs.
-- Recipients:
--   submit_fiche        → section admins (role admin_<section>)
--   request_unlock      → section admins
--   approve_unlock      → requesting teacher
--   refuse_unlock       → requesting teacher
-- ============================================================

-- ---------- Helper: section-admin user ids for a section ----------
create or replace function public.section_admin_ids(p_section text)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(ur.user_id), '{}')
  from public.user_roles ur
  where ur.role = 'admin_' || p_section;
$$;

-- ---------- Helper: teacher id of a fiche ----------
create or replace function public.fiche_teacher_id(p_fiche_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select a.enseignant_id
  from public.fiches f
  join public.attributions a on a.id = f.attribution_id
  where f.id = p_fiche_id;
$$;

-- ============================================================
-- Recreate submit_fiche with notifications
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
  v_admin_ids uuid[];
  v_admin uuid;
begin
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

  -- Notify section admins
  v_admin_ids := public.section_admin_ids(v_section);
  if cardinality(v_admin_ids) > 0 then
    foreach v_admin in array v_admin_ids
    loop
      perform public.notify_user(v_admin, 'fiche_soumise',
        jsonb_build_object('ficheId', p_fiche_id));
    end loop;
  end if;

  return query select true, 'Fiche soumise.';
end;
$$;

-- ============================================================
-- Recreate request_unlock with notifications
-- ============================================================
create or replace function public.request_unlock(p_fiche_id uuid, p_motif text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_pending int;
  v_section text;
  v_admin_ids uuid[];
  v_admin uuid;
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

  v_section := public.fiche_section(p_fiche_id);
  v_admin_ids := public.section_admin_ids(v_section);
  if cardinality(v_admin_ids) > 0 then
    foreach v_admin in array v_admin_ids
    loop
      perform public.notify_user(v_admin, 'demande_reouverture',
        jsonb_build_object('ficheId', p_fiche_id, 'motif', btrim(p_motif)));
    end loop;
  end if;

  return query select true, 'Demande envoyée.';
end;
$$;

-- ============================================================
-- Recreate approve_unlock with notification to the requester
-- ============================================================
create or replace function public.approve_unlock(p_request_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_fiche uuid;
  v_teacher uuid;
  v_statut text;
  v_actor uuid := auth.uid();
  v_section text;
begin
  select r.fiche_id, r.demandeur_id into v_fiche, v_teacher
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

  update public.fiches
     set statut = 'brouillon',
         submitted_at = null,
         version = version + 1
   where id = v_fiche;

  perform public.log_activity(v_fiche, v_actor, 'unlock_approved',
    jsonb_build_object('request_id', p_request_id));

  if v_teacher is not null then
    perform public.notify_user(v_teacher, 'demande_approuvee',
      jsonb_build_object('ficheId', v_fiche));
  end if;

  return query select true, 'Réouverture approuvée : la fiche est de nouveau en brouillon.';
end;
$$;

-- ============================================================
-- Recreate refuse_unlock with notification to the requester
-- ============================================================
create or replace function public.refuse_unlock(p_request_id uuid)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public
as $$
declare
  v_fiche uuid;
  v_teacher uuid;
  v_actor uuid := auth.uid();
  v_section text;
begin
  select r.fiche_id, r.demandeur_id into v_fiche, v_teacher
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

  if v_teacher is not null then
    perform public.notify_user(v_teacher, 'demande_refusee',
      jsonb_build_object('ficheId', v_fiche));
  end if;

  return query select true, 'Demande refusée.';
end;
$$;
