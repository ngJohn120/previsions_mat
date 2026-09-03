// Downloadable CSV header templates per entity (P6-1).

export type CsvEntity = "users" | "classes" | "branches" | "attributions";

export const CSV_TEMPLATES: Record<CsvEntity, { filename: string; header: string; example: string }> = {
  users: {
    filename: "import-utilisateurs.csv",
    header: "email,full_name,phone,role,section",
    example: "nouveau.prof@siloe.edu,Nouveau Professeur,+243 99 000 0000,enseignant,secondaire",
  },
  classes: {
    filename: "import-classes.csv",
    header: "name,level,ordre,titulaire_email",
    example: "5e A,5e,2,m.mbuyi@siloe.edu",
  },
  branches: {
    filename: "import-branches.csv",
    header: "name,sections,sous_branches",
    example: 'Sciences,"primaire,secondaire","Sciences physiques,Chimie"',
  },
  attributions: {
    filename: "import-attributions.csv",
    header: "section,classe,branche,sous_branche,enseignant_email",
    example: "secondaire,3e,Mathématiques,,m.kazadi@siloe.edu",
  },
};

export function csvTemplate(entity: CsvEntity): string {
  const t = CSV_TEMPLATES[entity];
  return `${t.header}\n${t.example}\n`;
}
