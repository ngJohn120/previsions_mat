-- ============================================================
-- Prévisions Matières — 0003_seed_test_accounts.sql
-- Test accounts for local/dev:
--   direction@siloe.edu   / Test1234!   (Super admin)
--   admin.prim@siloe.edu  / Test1234!   (Admin Primaire)
--   admin.sec@siloe.edu   / Test1234!   (Admin Secondaire)
--   m.kazadi@siloe.edu    / Test1234!   (Enseignant secondaire)
--   m.mbuyi@siloe.edu     / Test1234!   (Enseignant primaire)
-- ============================================================

create extension if not exists pgcrypto;

-- Helper: create auth user + profile + roles in one go
-- (uses crypt() so passwords are properly hashed; safe for seed)

create or replace function public.seed_test_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_phone text default null,
  p_roles jsonb default '[]'  -- [{ "role": "super_admin" }, { "role": "admin_secondaire", "section": "secondaire" }]
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_role jsonb;
begin
  -- Create auth user (idempotent: if exists, return existing)
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      p_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', p_full_name),
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
    returning id into v_user_id;
  end if;

  -- Profile
  insert into public.profiles (id, full_name, phone)
  values (v_user_id, p_full_name, p_phone)
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone;

  -- Roles
  for v_role in select * from jsonb_array_elements(p_roles)
  loop
    insert into public.user_roles (user_id, role, section)
    values (v_user_id, v_role->>'role', v_role->>'section')
    on conflict (user_id, role, section) do nothing;
  end loop;

  return v_user_id;
end;
$$;

select public.seed_test_user(
  'direction@siloe.edu',
  'Test1234!',
  'Direction SILOE',
  '+243 99 000 1122',
  '[{"role":"super_admin"}]'::jsonb
);

select public.seed_test_user(
  'admin.prim@siloe.edu',
  'Test1234!',
  'Ilunga wa Ilunga',
  '+243 81 555 7788',
  '[{"role":"admin_primaire","section":"primaire"},{"role":"enseignant","section":"primaire"}]'::jsonb
);

select public.seed_test_user(
  'admin.sec@siloe.edu',
  'Test1234!',
  'Mukendi Tshibanda',
  NULL,
  '[{"role":"admin_secondaire","section":"secondaire"},{"role":"enseignant","section":"secondaire"}]'::jsonb
);

select public.seed_test_user(
  'm.kazadi@siloe.edu',
  'Test1234!',
  'Kazadi Mutombo',
  NULL,
  '[{"role":"enseignant","section":"secondaire"}]'::jsonb
);

select public.seed_test_user(
  'm.mbuyi@siloe.edu',
  'Test1234!',
  'Mbuyi Kabongo',
  '+243 97 123 4567',
  '[{"role":"enseignant","section":"primaire"}]'::jsonb
);

-- Drop the helper (kept the schema clean)
drop function public.seed_test_user(text, text, text, text, jsonb);
