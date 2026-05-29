/**
 * Minimal RFC-4180 CSV serialization for the export endpoints.
 *
 * Fields containing a comma, double-quote, or newline are wrapped in double
 * quotes with embedded quotes doubled. Everything is server-rendered and the
 * data is the user's own already-normalized records, so there's no untrusted
 * input to worry about beyond correct quoting.
 */

type Cell = string | number | boolean | null | undefined;

function escapeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string from a header row and data rows. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // Trailing newline keeps POSIX tools (and Excel) happy.
  return lines.join("\r\n") + "\r\n";
}

/** A Response that downloads as a .csv file with the given name. */
export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
