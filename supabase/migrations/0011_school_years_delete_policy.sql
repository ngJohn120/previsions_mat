-- 0011: allow super admin to delete school years (rollover wizard cleanup).
-- Guarded in the app by deleteUpcomingYear (status='upcoming', empty year),
-- this policy scopes the DB-level permission to super admins only.
create policy "school_years_delete_admin"
  on public.school_years
  for delete
  to authenticated
  using (public.is_super_admin());