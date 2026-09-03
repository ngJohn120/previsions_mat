"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const YEAR_COOKIE = "pm_year";

export async function setActiveYear(yearId: string) {
  const cookieStore = await cookies();
  cookieStore.set(YEAR_COOKIE, yearId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  revalidatePath("/", "layout");
}
