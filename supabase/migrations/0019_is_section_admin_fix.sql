-- 0019_is_section_admin_fix.sql
-- Follow-up to 0018: RLS/notification helpers still matched the old role names
-- via 'admin_' || p_section. After 0018 the role is just 'admin', so replace
-- both helper bodies to check the role + section pair. (create or replace —
-- safe to re-run.)

create or replace function public.is_section_admin(p_section text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin' and section = p_section
  );
$$;

create or replace function public.section_admin_ids(p_section text)
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(ur.user_id), '{}')
  from public.user_roles ur
  where ur.role = 'admin' and ur.section = p_section;
$$;