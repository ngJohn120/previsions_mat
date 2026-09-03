import { redirect, notFound } from "next/navigation";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { AdminConflitsView } from "@/components/admin/admin-conflits-view";

export default async function FicheConflitsPage({
  params,
}: {
  params: Promise<{ ficheId: string }>;
}) {
  const { ficheId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getFicheForUser(ficheId);
  if (!data) notFound();

  const isAdmin =
    isSuperAdmin(user.roles) || isSectionAdmin(user.roles, data.meta.section);
  if (!isAdmin) redirect("/");

  return <AdminConflitsView data={data} />;
}
