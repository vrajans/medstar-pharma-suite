"use client";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export { esc as escapeHtml };

/**
 * Print arbitrary HTML through a hidden iframe, so reports never collide with the POS receipt
 * and nothing navigates away. layout: "thermal" (80 mm roll) or "a4" (landscape registers).
 */
export function printHtml(title: string, bodyHtml: string, layout: "thermal" | "a4" | "a4-portrait" = "thermal") {
  const a4 = "body{font:10px/1.35 system-ui,sans-serif}h1{font-size:14px;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}th{background:#eee}td.r,th.r{text-align:right}.head{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}.muted{color:#555}.sign{margin-top:36px;display:flex;justify-content:space-between}";
  const css = layout === "a4-portrait" ? `@page{size:A4 portrait;margin:12mm}${a4}` : layout === "thermal"
    ? "@page{size:80mm auto;margin:3mm}body{font:11px/1.3 ui-monospace,monospace;width:74mm}h1{font-size:13px;text-align:center;margin:0 0 4px}table{width:100%;border-collapse:collapse}td{padding:1px 0}td.r{text-align:right}hr{border:0;border-top:1px dashed #000}"
    : "@page{size:A4 landscape;margin:10mm}body{font:10px/1.35 system-ui,sans-serif}h1{font-size:14px;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px 4px;text-align:left;vertical-align:top}th{background:#eee}td.r{text-align:right}";
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 50);
}
