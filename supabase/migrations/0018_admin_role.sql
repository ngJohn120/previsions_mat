-- 0018_admin_role.sql
-- Consolidate section-admin roles: 'admin_primaire'/'admin_secondaire'
-- become a single 'admin' role; the existing `section` column keeps the scope.
-- super_admin and enseignant are unchanged.

alter table public.user_roles drop constraint user_roles_role_check;

update public.user_roles
   set role = 'admin'
 where role in ('admin_primaire', 'admin_secondaire');

alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('super_admin', 'admin', 'enseignant'));