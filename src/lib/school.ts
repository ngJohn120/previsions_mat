// School identity constants — used by on-screen doc headers and print sheets.
// (There is no school-settings table yet; keep in one place to change easily.)

export const SCHOOL = {
  name: "COMPLEXE SCOLAIRE SILOE",
  address: "2938/40, AV. LES ÉLITES — Q/GAMBELA — C/LUBUMBASHI",
} as const;

export function sectionLabel(section: "primaire" | "secondaire"): string {
  return section === "primaire" ? "Primaire" : "Secondaire";
}

export function titleForSection(section: "primaire" | "secondaire"): string {
  return section === "primaire" ? "PRÉVISION ANNUELLE" : "PRÉVISION DES MATIÈRES";
}
