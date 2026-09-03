-- ============================================================
-- Prévisions Matières — 0007_notifications.sql
-- notifications table + RLS
-- ============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,               -- fiche_soumise | demande_reouverture | demande_approuvee | demande_refusee | conflit | nouveau_modele
  payload jsonb not null default '{}'::jsonb,   -- { ficheId?, motif?, ... }
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- Users see only their own notifications
create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

-- Only server-side functions/triggers insert (via security definer or service)
create policy "notifications_insert_system"
  on public.notifications for insert
  with check (user_id = auth.uid() or public.is_super_admin());

create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid());

create policy "notifications_delete_own"
  on public.notifications for delete
  using (user_id = auth.uid());

-- ---------- Helper: notify a user (internal, security definer) ----------
create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, type, payload)
  values (p_user_id, p_type, p_payload);
$$;
