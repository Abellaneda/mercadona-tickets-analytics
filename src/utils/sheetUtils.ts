/**
 * Utilidades puras (sin dependencias de Google) reutilizadas por servicios y vistas.
 */

/** Redondea a 2 decimales evitando errores de coma flotante. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Construye una fórmula HYPERLINK con separador de coma (sintaxis que exige Apps Script
 * independientemente de la configuración regional de la hoja).
 */
export function buildHyperlinkFormula(url: string, label: string): string {
  const esc = (s: string): string => s.replace(/"/g, '""');
  return `=HYPERLINK("${esc(url)}","${esc(label)}")`;
}

/**
 * Extrae URL y texto de una fórmula HYPERLINK, aceptando separador ',' o ';'.
 */
export function parseHyperlinkFormula(formula: string): { url: string; label: string } | null {
  const match = formula.match(/^=HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[;,]\s*"((?:[^"]|"")*)"\s*\)$/i);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const unesc = (s: string): string => s.replace(/""/g, '"');
  return { url: unesc(match[1]), label: unesc(match[2]) };
}

/** Formatea una fecha como 'dd/mm/aaaa hh:mm' usando la hora local. */
export function formatDateEs(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
