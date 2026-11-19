"use client";
import { buildGstr1Json, type Gstr1Data } from "@medstar/core";

export function DownloadGstr1({ data, fp }: { data: Gstr1Data; fp: string }) {
  const { warnings } = buildGstr1Json(data, fp);
  return (
    <div className="flex flex-col items-end gap-1">
      <button className="rounded-md bg-brand-700 px-3 py-1.5 text-sm text-white" onClick={() => {
        const { json } = buildGstr1Json(data, fp);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(json)], { type: "application/json" }));
        a.download = `GSTR1_${data.gstin ?? "NOGSTIN"}_${fp}.json`;
        a.click(); URL.revokeObjectURL(a.href);
      }}>Download JSON for GST portal</button>
      {warnings.length > 0 && <ul className="max-w-md text-right text-xs text-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}
