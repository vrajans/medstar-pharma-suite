"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  expenseTax, formatINR, GROUP_LABEL, rupeesToPaise, validateVoucher, VOUCHER_LABEL,
  type LedgerGroup, type VoucherKind, type VoucherLineInput,
} from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";
import { inputCls } from "@/components/ui";

export interface LedgerOpt { id: string; code: string; name: string; grp: LedgerGroup | null }
export interface PartyOpt { id: string; label: string }

interface Row { accountId: string; partyId: string; dr: string; cr: string }
const emptyRow = (): Row => ({ accountId: "", partyId: "", dr: "", cr: "" });
const toPaise = (s: string) => { try { return s.trim() ? rupeesToPaise(s) : 0; } catch { return NaN; } };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const GROUP_ORDER: LedgerGroup[] = ["cash", "bank", "indirect_exp", "direct_exp", "indirect_inc", "debtors", "creditors", "tax_input", "tax_output",
  "current_asset", "fixed_asset", "current_liability", "loan", "capital", "sales", "stock"];

function LedgerSelect({ ledgers, value, onChange, filter, label }: {
  ledgers: LedgerOpt[]; value: string; onChange: (v: string) => void; filter?: (l: LedgerOpt) => boolean; label: string;
}) {
  const list = ledgers.filter((l) => l.grp !== "stock" && l.code !== "COGS" && (!filter || filter(l)));
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line bg-surface px-2 py-1.5">
      <option value="">— choose ledger —</option>
      {GROUP_ORDER.map((g) => {
        const items = list.filter((l) => l.grp === g);
        return items.length ? <optgroup key={g} label={GROUP_LABEL[g]}>{items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup> : null;
      })}
    </select>
  );
}

export function VoucherForm({ orgId, storeId, composition, ledgers, customers, suppliers, initialKind }: {
  orgId: string; storeId: string; composition: boolean; ledgers: LedgerOpt[]; customers: PartyOpt[]; suppliers: PartyOpt[]; initialKind: VoucherKind;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<VoucherKind>(initialKind);
  const [date, setDate] = useState(istToday());
  const [narration, setNarration] = useState("");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [exp, setExp] = useState({ accountId: "", amount: "", rate: "0", inter: false, claim: !composition, payFrom: "", supplierId: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = useMemo(() => new Map(ledgers.map((l) => [l.id, l])), [ledgers]);
  const byCode = (c: string) => ledgers.find((l) => l.code === c);

  // expense → lines
  const expLines = useMemo((): Array<VoucherLineInput & { accountId: string }> => {
    const a = byId.get(exp.accountId), pay = byId.get(exp.payFrom);
    const taxable = toPaise(exp.amount);
    if (!a || !pay || !taxable || Number.isNaN(taxable)) return [];
    const t = expenseTax(taxable, Number(exp.rate), exp.inter);
    const claim = exp.claim && !composition && Number(exp.rate) > 0;
    const lines: Array<VoucherLineInput & { accountId: string }> = [
      { accountId: a.id, code: a.code, grp: a.grp, name: a.name, debitPaise: claim ? taxable : t.totalPaise, creditPaise: 0 },
    ];
    if (claim) {
      for (const [code, v] of [["IN_CGST", t.cgstPaise], ["IN_SGST", t.sgstPaise], ["IN_IGST", t.igstPaise]] as const) {
        const l = byCode(code); if (l && v) lines.push({ accountId: l.id, code, grp: l.grp, name: l.name, debitPaise: v, creditPaise: 0 });
      }
    }
    lines.push({ accountId: pay.id, code: pay.code, grp: pay.grp, name: pay.name, debitPaise: 0, creditPaise: t.totalPaise, partyId: pay.code === "CREDITORS" ? exp.supplierId || null : null });
    return lines;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, byId, composition]);

  type Line = VoucherLineInput & { accountId: string };
  const gridLines: Line[] = rows.flatMap((r): Line[] => {
    const l = byId.get(r.accountId);
    return l ? [{ accountId: l.id, code: l.code, grp: l.grp, name: l.name, debitPaise: toPaise(r.dr), creditPaise: toPaise(r.cr), partyId: r.partyId || null }] : [];
  });

  const lines = kind === "expense" ? expLines : gridLines;
  const totalDr = lines.reduce((s, l) => s + (l.debitPaise || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (l.creditPaise || 0), 0);
  const problems = lines.some((l) => Number.isNaN(l.debitPaise) || Number.isNaN(l.creditPaise)) ? ["Check the amounts"] : validateVoucher(kind, lines, { composition });
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));

  return (
    <form className="space-y-4 text-sm" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      if (narration.trim().length < 3) { setMsg({ ok: false, text: "Add a narration (what is this for?)" }); return; }
      if (problems.length) { setMsg({ ok: false, text: problems.join(". ") }); return; }
      setBusy(true);
      const sb = supabaseBrowser()!;
      let attachmentPath: string | null = null;
      if (file) {
        attachmentPath = `${orgId}/vouchers/${key}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const up = await sb.storage.from("documents").upload(attachmentPath, file, { upsert: true });
        if (up.error) { setBusy(false); setMsg({ ok: false, text: `Attachment upload failed: ${up.error.message}` }); return; }
      }
      const { data, error } = await sb.rpc("post_voucher", { p: {
        idempotencyKey: key, storeId, kind, date, narration: narration.trim(), reference: reference.trim() || null, attachmentPath,
        lines: lines.map((l) => ({ accountId: l.accountId, debitPaise: l.debitPaise || 0, creditPaise: l.creditPaise || 0, partyId: l.partyId || null })),
      } });
      setBusy(false);
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      setMsg({ ok: true, text: `Saved ${data.voucherNo} for ${formatINR(data.amountPaise ?? totalDr)}` });
      setKey(crypto.randomUUID()); setRows([emptyRow(), emptyRow()]); setNarration(""); setReference(""); setFile(null);
      setExp((x) => ({ ...x, amount: "" }));
      router.refresh();
    }}>
      <div className="flex flex-wrap gap-1" role="tablist">
        {(Object.keys(VOUCHER_LABEL) as VoucherKind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1.5 ${kind === k ? "bg-brand-700 text-white" : "border border-line bg-surface"}`}>{VOUCHER_LABEL[k]}</button>))}
      </div>
      <p className="text-muted">{{
        payment: "Money going out of cash or bank — rent, salary, paying a supplier, depositing GST.",
        receipt: "Money coming in that isn't a sale — udhaar collected by bank transfer, other income, owner bringing in capital.",
        contra: "Moving money between cash, bank and UPI/card clearing — e.g. depositing cash, card settlement with bank charges.",
        journal: "Adjustments that don't move cash — opening balances, write-offs, corrections, GST set-off.",
        expense: "Record a shop expense with its bill. GST on the bill can be claimed as input tax credit (regular dealers).",
      }[kind]}</p>

      <div className="grid grid-cols-4 gap-3">
        <label>Date<input type="date" required value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} className={inputCls} /></label>
        <label className="col-span-2">Narration<input required value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. November rent, shop 12" className={inputCls} /></label>
        <label>Reference / bill no.<input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} /></label>
      </div>

      {kind === "expense" ? (
        <div className="grid grid-cols-4 gap-3 rounded-lg border border-line bg-surface p-3">
          <label className="col-span-2">Expense ledger
            <LedgerSelect label="Expense ledger" ledgers={ledgers} value={exp.accountId} onChange={(v) => setExp((x) => ({ ...x, accountId: v }))}
              filter={(l) => l.grp === "indirect_exp" || l.grp === "direct_exp" || l.grp === "fixed_asset"} /></label>
          <label>Amount before GST (₹)<input inputMode="decimal" value={exp.amount} onChange={(e) => setExp((x) => ({ ...x, amount: e.target.value }))} className={inputCls} /></label>
          <label>GST rate on the bill
            <select value={exp.rate} onChange={(e) => setExp((x) => ({ ...x, rate: e.target.value }))} className={inputCls}>
              {["0", "5", "12", "18", "28", "40"].map((r) => <option key={r} value={r}>{r === "0" ? "No GST / unregistered" : `${r}%`}</option>)}
            </select></label>
          <label className="col-span-2">Paid from
            <LedgerSelect label="Paid from" ledgers={ledgers} value={exp.payFrom} onChange={(v) => setExp((x) => ({ ...x, payFrom: v }))}
              filter={(l) => l.grp === "cash" || l.grp === "bank" || l.code === "CREDITORS" || l.grp === "current_liability"} /></label>
          {byId.get(exp.payFrom)?.code === "CREDITORS" && (
            <label>Supplier<select value={exp.supplierId} onChange={(e) => setExp((x) => ({ ...x, supplierId: e.target.value }))} className={inputCls}>
              <option value="">— supplier —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>)}
          <div className="col-span-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-1"><input type="checkbox" checked={exp.inter} onChange={(e) => setExp((x) => ({ ...x, inter: e.target.checked }))} /> Supplier is in another state (IGST)</label>
            {!composition && <label className="flex items-center gap-1"><input type="checkbox" checked={exp.claim} onChange={(e) => setExp((x) => ({ ...x, claim: e.target.checked }))} /> Claim GST as input tax credit (bill shows our GSTIN)</label>}
            {composition && <span className="text-muted">Composition dealer: GST on the bill is part of the expense.</span>}
          </div>
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full">
            <thead className="bg-canvas text-left text-xs uppercase text-muted"><tr><th className="p-2">Ledger</th><th>Customer / supplier</th><th className="w-36 text-right">Debit ₹</th><th className="w-36 pr-2 text-right">Credit ₹</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => {
              const l = byId.get(r.accountId);
              const parties = l?.code === "DEBTORS" ? customers : l?.code === "CREDITORS" ? suppliers : null;
              return (
                <tr key={i} className="border-t border-line">
                  <td className="p-1"><LedgerSelect label={`Ledger ${i + 1}`} ledgers={ledgers} value={r.accountId} onChange={(v) => setRow(i, { accountId: v, partyId: "" })} /></td>
                  <td className="p-1">{parties ? (
                    <select aria-label="Party" value={r.partyId} onChange={(e) => setRow(i, { partyId: e.target.value })} className="w-full rounded border border-line px-2 py-1.5">
                      <option value="">— choose —</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>) : <span className="text-muted">—</span>}</td>
                  <td className="p-1"><input aria-label="Debit" inputMode="decimal" value={r.dr} disabled={!!r.cr} onChange={(e) => setRow(i, { dr: e.target.value })} className="w-full rounded border border-line px-2 py-1 text-right" /></td>
                  <td className="p-1 pr-2"><input aria-label="Credit" inputMode="decimal" value={r.cr} disabled={!!r.dr} onChange={(e) => setRow(i, { cr: e.target.value })} className="w-full rounded border border-line px-2 py-1 text-right" /></td>
                  <td className="p-1">{rows.length > 2 && <button type="button" aria-label="Remove line" className="text-muted" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>);
            })}</tbody>
            <tfoot className="border-t border-line font-medium"><tr>
              <td className="p-2"><button type="button" className="text-brand-700 underline" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Add line</button></td>
              <td className="text-right text-muted">Totals</td>
              <td className="num p-2 text-right">{formatINR(totalDr || 0)}</td><td className="num p-2 pr-3 text-right">{formatINR(totalCr || 0)}</td><td />
            </tr></tfoot>
          </table>
        </div>
      )}

      {kind === "expense" && lines.length > 0 && (
        <table className="w-full max-w-xl text-sm"><tbody>
          {lines.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1">{l.debitPaise ? "Dr" : "Cr"} {l.name}</td>
            <td className="num text-right">{formatINR(l.debitPaise || l.creditPaise)}</td></tr>)}
        </tbody></table>)}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">Attach bill / receipt (photo or PDF)
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      {lines.length >= 2 && problems.length > 0 && <ul className="list-disc pl-5 text-warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving…" : `Save ${VOUCHER_LABEL[kind].split(" ")[0]!.toLowerCase()} voucher`}</button>
        {msg && <span role="status" className={msg.ok ? "text-ok" : "text-danger"}>{msg.text}</span>}
      </div>
    </form>
  );
}
