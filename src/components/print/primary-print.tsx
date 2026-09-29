import type { FicheMeta, FicheRow, FicheStatut } from "@/lib/fiche-types";
import { eventLabelInWeek, monthBlocks, weeksWithEvents } from "@/lib/fiche-events";
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
  // Paper-faithful: one row per teaching week, with the event printed in its own
  // column on the FIRST week it covers (shared with the on-screen grid).
  const weeks = weeksWithEvents(rows);
  const months = monthBlocks(weeks.map((w) => w.row));

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
        {weeks.map((w, i) => {
          const month = months[i];
          return (
            <tr key={w.row.id}>
              {month.label !== null && (
                <td className="mois" rowSpan={month.rowspan}>{month.label}</td>
              )}
              <td className="num">{primaryWeekLabel(w.row)}</td>
              {w.event ? (
                <td className="c ev" colSpan={4}>
                  {eventLabelInWeek(w.event, w.row, w.continues)}
                </td>
              ) : (
                <>
                  <td className="c">{w.row.cells.matieres?.value ?? ""}</td>
                  <td className="c">{w.row.cells.ref?.value ?? ""}</td>
                  <td className="c">{w.row.cells.intention?.value ?? ""}</td>
                  <td className="c">{w.row.cells.obs?.value ?? ""}</td>
                </>
              )}
            </tr>
          );
        })}
        {weeks.length === 0 && (
          <tr><td colSpan={6} className="c">Aucune ligne.</td></tr>
        )}
      </tbody>
    </table>
  );
}
