import { SCHOOL } from "@/lib/school";
import type { FicheMeta, FicheStatut } from "@/lib/fiche-types";
import type { Section } from "@/lib/auth";

/** Paper-style document header used on each print sheet. */
export function PrintDocHeader({
  meta,
  title,
  signatureLabel,
}: {
  meta: FicheMeta;
  title: string;
  signatureLabel: string;
}) {
  return (
    <>
      <div className="print-hdr">
        <div className="school">{SCHOOL.name}</div>
        <div className="addr">{SCHOOL.address}</div>
        <div className="annee">ANNÉE SCOLAIRE {meta.school_year_label || "—"}</div>
      </div>
      <div className="print-title">{title}</div>
      <table className="fields">
        <tbody>
          <tr>
            <Field label="Section" value={meta.section === "primaire" ? "PRIMAIRE" : "SECONDAIRE"} />
            <Field label="Classe" value={meta.classe} />
            <Field label={meta.section === "primaire" ? "Titulaire" : "Professeur"} value={meta.enseignant} />
          </tr>
          <tr>
            <Field label="Branche" value={meta.cours} />
            {meta.section === "primaire" ? (
              <Field label="Sous-branche" value={meta.sous_branche ?? "—"} />
            ) : (
              <td colSpan={2} />
            )}
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
      <span className="sr-only">{signatureLabel}</span>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <td className="lbl">{label.toUpperCase()} :</td>
      <td className="val">{value.toUpperCase()}</td>
    </>
  );
}

/** A4-landscape sheet shell with watermark (draft only). */
export function PrintSheet({
  meta,
  title,
  signatureLabel,
  statut,
  page,
  totalPages,
  children,
}: {
  meta: FicheMeta;
  title: string;
  signatureLabel: string;
  statut: FicheStatut;
  page: number;
  totalPages: number;
  children: React.ReactNode;
}) {
  const draft = statut === "brouillon";
  return (
    <div className={`sheet ${page > 1 ? "break-page" : ""}`}>
      {draft && (
        <div className="wm" aria-hidden>
          <span>Brouillon</span>
        </div>
      )}
      <div className="doc">
        <PrintDocHeader meta={meta} title={title} signatureLabel={signatureLabel} />
        {children}
        {/* Signature on last page */}
        {page === totalPages && (
          <div className="sign">
            <div className="fait">Fait à Lubumbashi, le {new Date().toLocaleDateString("fr-FR")}</div>
            <div className="dir">
              <div>{signatureLabel}</div>
              <div className="l1">…………………………………</div>
            </div>
          </div>
        )}
        <div className="page-note">— Page {page} / {totalPages} —</div>
      </div>
    </div>
  );
}
