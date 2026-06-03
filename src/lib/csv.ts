/**
 * Small RFC-4180-ish CSV parser handling the edge cases the spec calls out
 * (DA-import): UTF-8 BOM, quoted fields with embedded commas/newlines, escaped
 * quotes (""), CRLF/LF, and auto-detected delimiter (comma / semicolon / tab).
 *
 * Pure and dependency-free so it's trivially unit-tested and worker-portable.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

const DELIMITERS = [',', ';', '\t'];

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Guess the delimiter from the first non-empty line (most-frequent wins). */
export function detectDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of DELIMITERS) {
    // Count delimiters outside quotes.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Tokenize one CSV document into a 2D array of cells. */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

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
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush trailing field/row if there's content.
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export function parseCsv(raw: string): ParsedCsv {
  const text = stripBom(raw);
  const delimiter = detectDelimiter(text);
  const cells = tokenize(text, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  if (cells.length === 0) return { headers: [], rows: [], delimiter };

  const headers = cells[0]!.map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < cells.length; r++) {
    const rec: Record<string, string> = {};
    const line = cells[r]!;
    headers.forEach((h, c) => {
      rec[h] = (line[c] ?? '').trim();
    });
    rows.push(rec);
  }
  return { headers, rows, delimiter };
}
