-- ============================================================
-- Prévisions Matières — 0009_notify_conflict.sql
-- Security-definer RPC to notify the teacher of a detected conflict
-- (idempotent: no duplicate unread conflict notifications per fiche).
-- ============================================================

create or replace function public.notify_conflict(p_fiche_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_teacher uuid;
  v_exists boolean;
begin
  select a.enseignant_id into v_teacher
    from public.fiches f
    join public.attributions a on a.id = f.attribution_id
    where f.id = p_fiche_id;
  if v_teacher is null then
    return;
  end if;

  select exists (
    select 1 from public.notifications
    where user_id = v_teacher
      and type = 'conflit'
      and read_at is null
      and payload->>'ficheId' = p_fiche_id::text
  ) into v_exists;

  if not v_exists then
    perform public.notify_user(v_teacher, 'conflit',
      jsonb_build_object('ficheId', p_fiche_id));
  end if;
end;
$$;
