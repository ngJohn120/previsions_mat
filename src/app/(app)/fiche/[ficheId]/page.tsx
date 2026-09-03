import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser, canEditFiche } from "@/lib/fiche";
import { EditorPage } from "@/components/editor/editor-page";

export default async function FichePage({
  params,
}: {
  params: Promise<{ ficheId: string }>;
}) {
  const { ficheId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getFicheForUser(ficheId);
  if (!data) notFound();

  const editable = await canEditFiche(data, user);

  return (
    <EditorPage
      data={data}
      editable={editable}
      viewerName={user.fullName ?? user.email ?? ""}
    />
  );
}
