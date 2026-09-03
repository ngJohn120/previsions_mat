// One-off: create the active 2026 – 2027 school year (idempotent).
// Run: node scripts/seed-year.mjs
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const c = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await c.from("school_years").insert({
  label: "2026 – 2027",
  start_date: "2026-09-01",
  end_date: "2027-07-07",
  status: "active",
}).select("id, label");

if (error) {
  if (error.code === "23505" || /duplicate/i.test(error.message)) {
    console.log("year already exists");
  } else {
    console.error("ERR", error.message);
    process.exit(1);
  }
} else {
  console.log("created", data[0].id);
}
