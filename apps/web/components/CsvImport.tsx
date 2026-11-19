"use client";
import { useState } from "react";
import { csvToObjects, toCsv } from "@medstar/core";

export interface ServerCheck { dryRun?: boolean; errors: Array<{ row: number; message: string }>; warnings?: Array<{ row: number; message: string }>; summary: string }

/**
 * Three-step import: (1) parse + validate in the browser, (2) dry run on the server (nothing written),
 * (3) commit all-or-nothing. Used for the product master and opening stock.
 */
export function CsvImport<T>({ templateName, templateRows, parseRow, check, commit, describe }: {
  templateName: string;
  templateRows: string[][];
  parseRow: (r: Record<string, string>) => { ok: true; value: T } | { ok: false; errors: string[] };
  check: (rows: T[]) => Promise<ServerCheck>;
  commit: (rows: T[]) => Promise<ServerCheck>;
  describe: (row: T) => string;
}) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Array<{ line: number; value?: T; errors?: string[] }>>([]);
  const [server, setServer] = useState<ServerCheck | null>(null);
  const [done, setDone] = useState<ServerCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const good = parsed.filter((p) => p.value).map((p) => p.value!);
  const bad = parsed.filter((p) => p.errors);

  const load = async (f: File) => {
    setFileName(f.name); setServer(null); setDone(null); setErr(null);
    const rows = csvToObjects(await f.text());
    setParsed(rows.map((r, i) => {
      const res = parseRow(r);
      return res.ok ? { line: i + 2, value: res.value } : { line: i + 2, errors: res.errors };
    }));
  };

  const run = async (fn: (rows: T[]) => Promise<ServerCheck>, isCommit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await fn(good);
      if (isCommit) setDone(r); else setServer(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([toCsv(templateRows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = templateName; a.click();
    URL.revokeObjectURL(a.href);
  };

  // server row numbers are 1-based positions in the submitted (valid-only) list → map back to file lines
  const fileLine = (serverRow: number) => parsed.filter((p) => p.value)[serverRow - 1]?.line ?? serverRow;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <span className="font-medium">1 · Choose a CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
        <button type="button" className="text-brand-700 underline" onClick={download}>Download template</button>
        <span className="text-muted">Export from Excel as &quot;CSV UTF-8&quot;. Marg/GoFrugal/Tally exports work if the column names match the template.</span>
      </div>

      {fileName && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="mb-2"><span className="font-medium">{fileName}</span>: {good.length} valid row(s), <span className={bad.length ? "text-danger" : ""}>{bad.length} with errors</span></p>
          {bad.length > 0 && (
            <ul className="mb-2 max-h-48 space-y-0.5 overflow-auto text-danger">
              {bad.slice(0, 200).map((b) => <li key={b.line}>Line {b.line}: {b.errors!.join("; ")}</li>)}
            </ul>
          )}
          {good.length > 0 && (
            <details className="mb-2"><summary className="cursor-pointer text-muted">Preview first 20 valid rows</summary>
              <ul className="mt-1 space-y-0.5">{good.slice(0, 20).map((g, i) => <li key={i}>{describe(g)}</li>)}</ul>
            </details>
          )}
          <button disabled={busy || !good.length || bad.length > 0} onClick={() => void run(check, false)} className="rounded-md bg-brand-700 px-3 py-1.5 text-white disabled:opacity-40">
            2 · Check with server (nothing is saved)
          </button>
          {bad.length > 0 && <span className="ml-2 text-muted">Fix the errors in the file and choose it again.</span>}
        </div>
      )}

      {server && !done && (
        <div className={`rounded-lg border p-4 ${server.errors.length ? "border-danger bg-danger/5" : "border-ok bg-ok/5"}`}>
          <p className="font-medium">{server.summary}</p>
          {server.errors.map((e, i) => <p key={i} className="text-danger">Line {fileLine(e.row)}: {e.message}</p>)}
          {server.warnings?.map((w, i) => <p key={i} className="text-warn">Line {fileLine(w.row)}: {w.message}</p>)}
          {!server.errors.length && (
            <button disabled={busy} onClick={() => void run(commit, true)} className="mt-2 rounded-md bg-ok px-3 py-1.5 text-white disabled:opacity-40">3 · Import now</button>
          )}
        </div>
      )}

      {done && <div className="rounded-lg border border-ok bg-ok/5 p-4 font-medium text-ok">✓ {done.summary}</div>}
      {err && <p role="alert" className="text-danger">{err}</p>}
    </div>
  );
}
