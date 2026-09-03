// Pure CSV parsing + row validators (no I/O; unit-testable).

export type CsvRow = string[];
export type CsvParseResult = { rows: CsvRow[]; errors: { line: number; message: string }[] };

/**
 * Parse a CSV string into rows. Handles quoted fields with commas and
 * newlines inside quotes, and CRLF line endings. Returns rows of raw strings
 * plus per-line errors for unterminated quotes etc.
 */
export function parseCsv(text: string): CsvParseResult {
  const errors: { line: number; message: string }[] = [];
  const rows: CsvRow[] = [];
  let row: CsvRow = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let i = 0;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    // not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF
      if (text[i + 1] === "\n") {
        pushRow();
        line++;
        i += 2;
        continue;
      }
      pushRow();
      line++;
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      line++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // flush last field/row if there was content
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  // drop a single trailing empty row caused by trailing newline
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  if (inQuotes) {
    errors.push({ line, message: "Guillemet non fermé dans le fichier CSV." });
  }

  return { rows, errors };
}

/** Normalize a header cell (trim, lowercase, strip accents for lenient matching). */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type ValidationIssue = { line: number; message: string };

/** Trim all cells in a data row (header not included). */
function trimRow(row: CsvRow): CsvRow {
  return row.map((c) => c.trim());
}

// ---------- Validators per entity ----------

export type UserCsvRow = {
  email: string;
  full_name: string;
  phone?: string;
  role: string; // super_admin | admin_primaire | admin_secondaire | enseignant
  section?: string; // primaire | secondaire
};

export function validateUsersCsv(rows: CsvRow[]): { data: UserCsvRow[]; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const data: UserCsvRow[] = [];
  const roles = new Set(["super_admin", "admin_primaire", "admin_secondaire", "enseignant"]);
  const sections = new Set(["primaire", "secondaire", ""]);

  rows.forEach((raw, idx) => {
    const line = idx + 2; // +1 header, +1 zero-based
    const r = trimRow(raw);
    const email = r[0] ?? "";
    const fullName = r[1] ?? "";
    const phone = r[2] ?? "";
    const role = (r[3] ?? "").toLowerCase();
    const section = (r[4] ?? "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push({ line, message: `E-mail invalide : « ${email || "(vide)"} »` });
      return;
    }
    if (!fullName) {
      errors.push({ line, message: "Nom complet manquant." });
      return;
    }
    if (!roles.has(role)) {
      errors.push({ line, message: `Rôle invalide : « ${role || "(vide)"} » (attendu: ${[...roles].join(", ")})` });
      return;
    }
    if (!sections.has(section)) {
      errors.push({ line, message: `Section invalide : « ${section} » (primaire|secondaire)` });
      return;
    }
    data.push({ email, full_name: fullName, phone: phone || undefined, role, section: section || undefined });
  });

  return { data, errors };
}

export type ClassCsvRow = {
  name: string;
  level: string;
  ordre?: number;
  titulaire_email?: string;
};

export function validateClassesCsv(rows: CsvRow[]): { data: ClassCsvRow[]; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const data: ClassCsvRow[] = [];
  rows.forEach((raw, idx) => {
    const line = idx + 2;
    const r = trimRow(raw);
    const name = r[0] ?? "";
    const level = r[1] ?? "";
    const titulaireEmail = r[3] ?? "";
    if (!name) {
      errors.push({ line, message: "Nom de classe manquant." });
      return;
    }
    if (!level) {
      errors.push({ line, message: `Niveau manquant pour « ${name} ».` });
      return;
    }
    if (titulaireEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(titulaireEmail)) {
      errors.push({ line, message: `E-mail du titulaire invalide : « ${titulaireEmail} »` });
      return;
    }
    data.push({ name, level, titulaire_email: titulaireEmail || undefined });
  });
  return { data, errors };
}

export type BranchCsvRow = {
  name: string;
  sections: string[]; // e.g. ['primaire','secondaire']
  sous_branches: string[];
};

export function validateBranchesCsv(rows: CsvRow[]): { data: BranchCsvRow[]; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const data: BranchCsvRow[] = [];
  rows.forEach((raw, idx) => {
    const line = idx + 2;
    const r = trimRow(raw);
    const name = r[0] ?? "";
    const sections = (r[1] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const sousBranches = (r[2] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name) {
      errors.push({ line, message: "Nom de branche manquant." });
      return;
    }
    if (!sections.length || sections.some((s) => !["primaire", "secondaire"].includes(s))) {
      errors.push({ line, message: `Sections invalides pour « ${name} » (primaire,secondaire).` });
      return;
    }
    data.push({ name, sections, sous_branches: sousBranches });
  });
  return { data, errors };
}

export type AttributionCsvRow = {
  section: string;
  classe: string;
  branche: string;
  sous_branche?: string;
  enseignant_email: string;
};

export function validateAttributionsCsv(rows: CsvRow[]): { data: AttributionCsvRow[]; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const data: AttributionCsvRow[] = [];
  rows.forEach((raw, idx) => {
    const line = idx + 2;
    const r = trimRow(raw);
    const section = (r[0] ?? "").toLowerCase();
    const classe = r[1] ?? "";
    const branche = r[2] ?? "";
    const sousBranche = r[3] ?? "";
    const email = r[4] ?? "";
    if (!["primaire", "secondaire"].includes(section)) {
      errors.push({ line, message: `Section invalide : « ${section || "(vide)"} »` });
      return;
    }
    if (!classe) {
      errors.push({ line, message: "Classe manquante." });
      return;
    }
    if (!branche) {
      errors.push({ line, message: "Branche (cours) manquante." });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push({ line, message: `E-mail enseignant invalide : « ${email || "(vide)"} »` });
      return;
    }
    data.push({ section, classe, branche, sous_branche: sousBranche || undefined, enseignant_email: email });
  });
  return { data, errors };
}
