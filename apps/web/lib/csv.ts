/** A small local CSV parser for the import wizard's preview (first ~64 KB of the file).
 * Handles quotes, escaped ("") quotes, delimiters and newlines inside quotes, and CRLF/LF. The
 * server (Rust `csv` crate) is the source of truth for the real parse; this is preview-only. */

/** The three separators the server (Rust `csv` crate) accepts. */
export type Delimiter = "," | ";" | "\t";
export type CsvPreview = { delimiter: Delimiter; rows: string[][] };

/** Strips a UTF-8 BOM, if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parses CSV text with a known delimiter into rows of cells. Ragged rows are padded by callers, not here. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = stripBom(text);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      // Swallowed; \n (bare or following \r) ends the row.
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop a single trailing blank line (from a final newline in the file).
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

/** `,` or `;` — whichever appears more often outside quotes on the first line. Good enough for a preview;
 * the server only accepts `,`, `;` or tab, and the user can override the choice in step 2. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  let inQuotes = false;
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const c of firstLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c as Delimiter]++;
  }
  const [best] = (Object.entries(counts) as [Delimiter, number][]).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ",";
}

/** Parses up to `maxRows` rows (including a header row, if any) from a chunk of CSV text, auto-detecting
 * the delimiter. Rows are padded/truncated to the widest row's length so every row has the same shape. */
export function previewCsv(text: string, maxRows = 20): CsvPreview {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter).slice(0, maxRows);
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return { delimiter, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) };
}
