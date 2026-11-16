// Minimal CSV writer (RFC 4180). Cells that a spreadsheet could read as a formula are neutralised.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/** columns: [{ key, header }] */
export function toCsv(rows, columns) {
  let out = csvRow(columns.map((c) => c.header));
  for (const row of rows) out += csvRow(columns.map((c) => row[c.key]));
  return out;
}

export function safeFilename(text) {
  return String(text || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
}
