"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseCsv, type CsvRow } from "@/lib/csv";
import { CSV_TEMPLATES, type CsvEntity } from "@/lib/csv-templates";

export type ImportResult = { created: number; errors: string[] };

/**
 * Generic CSV import dialog. Parses + validates client-side, shows a preview
 * with row errors, and calls the entity's import action with parsed rows.
 */
export function CsvImportDialog({
  entity,
  onOpenChange,
  onImported,
  importAction,
  templateColumns,
}: {
  entity: CsvEntity;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
  /** (rows) => Promise<ImportResult> */
  importAction: (rows: CsvRow[]) => Promise<ImportResult>;
  /** Human column names for preview, e.g. ["email","nom","téléphone","rôle","section"] */
  templateColumns: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [rowErrors, setRowErrors] = useState<{ line: number; message: string }[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const template = CSV_TEMPLATES[entity];

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setFatal(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCsv(text);
      setRows(parsed.rows);
      setRowErrors(parsed.errors);
      if (parsed.errors.length) setFatal(parsed.errors[0].message);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const header = CSV_TEMPLATES[entity].header;
    const example = CSV_TEMPLATES[entity].example;
    const blob = new Blob([`${header}\n${example}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = template.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await importAction(rows.slice(1)); // skip header row
      setResult(res);
      onImported?.();
    } catch (e) {
      setResult({ created: 0, errors: [e instanceof Error ? e.message : "Erreur import"] });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setRows(null);
    setRowErrors([]);
    setResult(null);
    setFatal(null);
    onOpenChange(false);
  }

  const dataRows = rows ? rows.slice(1) : [];
  const preview = rows ? rows.slice(0, 6) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer ({entity})</DialogTitle>
          <DialogDescription>
            Fichier CSV attendu : <code className="rounded bg-slate-100 px-1">{template.header}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
            />
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              Télécharger le modèle
            </Button>
          </div>

          {fatal && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fatal}</div>
          )}

          {rows && !fatal && (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {templateColumns.map((c) => <th key={c} className="px-2 py-1.5">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((r, i) => (
                      <tr key={i}>
                        {templateColumns.map((_, ci) => (
                          <td key={ci} className="max-w-[200px] truncate px-2 py-1.5">{r[ci] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                {dataRows.length} ligne(s) de données · {rowErrors.length} erreur(s) de structure
              </p>
            </>
          )}

          {result && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-semibold text-green-700">{result.created} importé(s)</span>
              {result.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-red-600">
                  {result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 8 && <li>… et {result.errors.length - 8} autre(s)</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>Fermer</Button>
          <Button onClick={doImport} disabled={Boolean(!rows || fatal || busy || dataRows.length === 0)}>
            {busy ? "Import…" : "Importer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
