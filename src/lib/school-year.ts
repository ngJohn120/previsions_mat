import { createClient } from "@/lib/supabase/server";

export type SchoolYear = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "archived";
};

export async function getActiveSchoolYear(): Promise<SchoolYear | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("school_years")
    .select("id, label, start_date, end_date, status")
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SchoolYear) ?? null;
}

export async function listSchoolYears(): Promise<SchoolYear[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("school_years")
    .select("id, label, start_date, end_date, status")
    .order("start_date", { ascending: false });
  return (data as SchoolYear[]) ?? [];
}
