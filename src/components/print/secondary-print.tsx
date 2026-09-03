import type { FicheRow, FicheMeta, FicheStatut } from "@/lib/fiche-types";
import { PrintSheet } from "@/components/print/print-sheet";

/** Secondary "Prévision des matières" print body (all sheets). */
export function SecondaryPrint({
  pages,
  meta,
  statut,
}: {
  pages: FicheRow[][];
  meta: FicheMeta;
  statut: FicheStatut;
}) {
  return (
    <>
      {pages.map((rows, i) => (
        <PrintSheet
          key={i}
          meta={meta}
          title="Prévision des matières"
          signatureLabel="Le Préfet / D.E."
          statut={statut}
          page={i + 1}
          totalPages={pages.length}
        >
          <SecondaryGridPrint rows={rows} />
        </PrintSheet>
      ))}
    </>
  );
}

function SecondaryGridPrint({ rows }: { rows: FicheRow[] }) {
  // Render period separators whenever the period label changes, and event rows
  // as bands, matching the paper form.
  const items: { kind: "period" | "event" | "teaching"; row?: FicheRow; label?: string }[] = [];
  let lastPeriod: string | null = null;
  for (const r of rows) {
    if (r.row_type === "evenement") {
      items.push({ kind: "event", row: r });
      continue;
    }
    const period = r.periode_label;
    if (period && period !== lastPeriod) {
      items.push({ kind: "period", label: period });
      lastPeriod = period;
    }
    items.push({ kind: "teaching", row: r });
  }

  return (
    <table className="grid">
      <thead>
        <tr>
          <th style={{ width: 32 }}>N</th>
          <th style={{ width: 150 }}>Semaines</th>
          <th style={{ width: 50 }}>Heure</th>
          <th>Matières prévues</th>
          <th style={{ width: 130 }}>M.V.</th>
          <th style={{ width: 100 }}>Obs.</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, idx) => {
          if (it.kind === "period") {
            return (
              <tr key={`p-${idx}`}>
                <td className="period" colSpan={6}>{it.label}</td>
              </tr>
            );
          }
          if (it.kind === "event") {
            const r = it.row!;
            return (
              <tr key={r.id}>
                <td className="band" colSpan={6}>
                  {r.date_label ? `${r.date_label} · ` : ""}{r.periode_label ?? ""}
                </td>
              </tr>
            );
          }
          const r = it.row!;
          return (
            <tr key={r.id}>
              <td className="num">{r.semaine_num ?? ""}</td>
              <td className="dates">{r.date_label ?? ""}</td>
              <td className="heur">{r.cells.heure?.value ?? ""}</td>
              <td>{r.cells.matieres?.value ?? ""}</td>
              <td className="mv">{r.cells.mv?.value ?? ""}</td>
              <td className="obs">{r.cells.obs?.value ?? ""}</td>
            </tr>
          );
        })}
        {items.length === 0 && (
          <tr><td colSpan={6} className="c">Aucune ligne.</td></tr>
        )}
      </tbody>
    </table>
  );
}
