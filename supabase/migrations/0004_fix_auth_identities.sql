-- ============================================================
-- Prévisions Matières — 0004_fix_auth_identities.sql
-- GoTrue requires an auth.identities row per email/password user.
-- The direct auth.users insert in 0003 skipped identities, which
-- breaks sign-in ("Database error querying schema"). This adds
-- the missing identities for the seeded test accounts.
-- ============================================================

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  u.id::text as provider_id,
  u.id as user_id,
  jsonb_build_object('sub', u.id::text, 'email', u.email) as identity_data,
  'email' as provider,
  now() as last_sign_in_at,
  now() as created_at,
  now() as updated_at
from auth.users u
where u.email in (
  'direction@siloe.edu',
  'admin.prim@siloe.edu',
  'admin.sec@siloe.edu',
  'm.kazadi@siloe.edu',
  'm.mbuyi@siloe.edu'
)
on conflict (provider, provider_id) do nothing;
