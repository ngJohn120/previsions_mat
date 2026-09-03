// Recreate the SILOE test users via the Supabase Admin API.
// Run: node scripts/recreate-test-users.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const users = [
  { email: "direction@siloe.edu", password: "Test1234!", full_name: "Direction SILOE", phone: "+243 99 000 1122", roles: [{ role: "super_admin" }] },
  { email: "admin.prim@siloe.edu", password: "Test1234!", full_name: "Ilunga wa Ilunga", phone: "+243 81 555 7788", roles: [{ role: "admin_primaire", section: "primaire" }, { role: "enseignant", section: "primaire" }] },
  { email: "admin.sec@siloe.edu", password: "Test1234!", full_name: "Mukendi Tshibanda", phone: null, roles: [{ role: "admin_secondaire", section: "secondaire" }, { role: "enseignant", section: "secondaire" }] },
  { email: "m.kazadi@siloe.edu", password: "Test1234!", full_name: "Kazadi Mutombo", phone: null, roles: [{ role: "enseignant", section: "secondaire" }] },
  { email: "m.mbuyi@siloe.edu", password: "Test1234!", full_name: "Mbuyi Kabongo", phone: "+243 97 123 4567", roles: [{ role: "enseignant", section: "primaire" }] },
];

for (const u of users) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (error) {
    console.error(`createUser ${u.email} FAILED:`, error.message);
    continue;
  }
  const userId = data.user.id;
  console.log(`created ${u.email} (${userId})`);

  // Profile
  const { error: pErr } = await admin.from("profiles").insert({
    id: userId, full_name: u.full_name, phone: u.phone ?? null,
  });
  if (pErr) console.error(`  profile ${u.email} FAILED:`, pErr.message);

  // Roles
  for (const r of u.roles) {
    const { error: rErr } = await admin.from("user_roles").insert({
      user_id: userId, role: r.role, section: r.section ?? null,
    });
    if (rErr) console.error(`  role ${r.role} for ${u.email} FAILED:`, rErr.message);
  }
}

console.log("done.");
