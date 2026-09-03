import type { FicheRow, FicheMeta, FicheStatut } from "@/lib/fiche-types";
import { PrintSheet } from "@/components/print/print-sheet";
import { primaryWeekLabel } from "@/lib/print";

/**
 * Primary annual plan print body (all sheets). Given already-split pages,
 * renders each page as a PrintSheet with the primary grid.
 */
export function PrimaryPrint({
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
          title="Prévision annuelle"
          signatureLabel="La Direction"
          statut={statut}
          page={i + 1}
          totalPages={pages.length}
        >
          <PrimaryGridPrint rows={rows} />
        </PrintSheet>
      ))}
    </>
  );
}

function PrimaryGridPrint({ rows }: { rows: FicheRow[] }) {
  // Group consecutive teaching rows by month into display rows with rowspan.
  const display: { row: FicheRow; monthLabel: string | null; rowspan: number }[] = [];
  const teaching = rows.filter((r) => r.row_type === "enseignement");
  let ti = 0;
  for (const r of rows) {
    if (r.row_type === "evenement") {
      display.push({ row: r, monthLabel: null, rowspan: 0 });
      continue;
    }
    const prev = teaching[ti - 1];
    const isNewMonth = !prev || prev.mois !== r.mois;
    let rowspan = 1;
    if (isNewMonth) {
      let j = ti;
      while (j + 1 < teaching.length && teaching[j + 1].mois === r.mois) j++;
      rowspan = j - ti + 1;
    }
    display.push({ row: r, monthLabel: isNewMonth ? r.mois : null, rowspan });
    ti++;
  }

  return (
    <table className="grid">
      <thead>
        <tr>
          <th style={{ width: 74 }}>Mois</th>
          <th style={{ width: 118 }}>Semaine — Date</th>
          <th>Matières à enseigner</th>
          <th style={{ width: 180 }}>Réf.</th>
          <th style={{ width: 220 }}>Intention</th>
          <th style={{ width: 60 }}>Obs.</th>
        </tr>
      </thead>
      <tbody>
        {display.map((d, idx) =>
          d.row.row_type === "evenement" ? (
            <tr key={d.row.id} className="band">
              <td colSpan={6}>{d.row.periode_label ?? d.row.date_label ?? ""}</td>
            </tr>
          ) : (
            <tr key={d.row.id}>
              {d.monthLabel !== null && (
                <td className="mois" rowSpan={d.rowspan}>{d.monthLabel}</td>
              )}
              <td className="num">{primaryWeekLabel(d.row)}</td>
              <td className="c">{d.row.cells.matieres?.value ?? ""}</td>
              <td className="c">{d.row.cells.ref?.value ?? ""}</td>
              <td className="c">{d.row.cells.intention?.value ?? ""}</td>
              <td className="c">{d.row.cells.obs?.value ?? ""}</td>
            </tr>
          )
        )}
        {display.length === 0 && (
          <tr><td colSpan={6} className="c">Aucune ligne.</td></tr>
        )}
      </tbody>
    </table>
  );
}
