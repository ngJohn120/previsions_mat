import { redirect, notFound } from "next/navigation";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { pendingUnlockRequests } from "@/app/(app)/admin/unlock-actions";
import { FicheReadOnly } from "@/components/admin/fiche-readonly";

export default async function FicheConsultationPage({
  params,
}: {
  params: Promise<{ ficheId: string }>;
}) {
  const { ficheId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getFicheForUser(ficheId);
  if (!data) notFound();

  const viewerIsAdmin =
    isSuperAdmin(user.roles) || isSectionAdmin(user.roles, data.meta.section);

  const pending = viewerIsAdmin ? await pendingUnlockRequests(ficheId) : [];

  return (
    <FicheReadOnly
      data={data}
      viewerIsAdmin={viewerIsAdmin}
      pendingRequests={pending}
    />
  );
}
