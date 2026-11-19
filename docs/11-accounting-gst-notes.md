# Accounting & GST — design notes and points for the CA to confirm

Owner: `accounting-sme` · Sprint 5 · Status: built, **CA review needed before the first filing**

## How the books work
- Every document posts a balanced journal entry in the same database transaction (sale, credit note, cancellation, purchase, debit note, receipt, supplier payment, stock adjustment, opening stock, cash in/out, shift close, manual voucher). Ledgers are append-only: corrections are reversals.
- Perpetual inventory: purchases debit *Stock in trade* at landed cost; every sale posts *Cost of goods sold* at the FEFO batch cost. P&L therefore needs no closing-stock entry.
- Income and expense ledgers start afresh on 1 April. Earlier years' profit appears as one line ("Profit & loss of earlier years") until year-end closing (UC-ACC-08, R2).
- Manual vouchers cannot touch *Stock in trade* or *Cost of goods sold* (use purchase / stock adjustment) so the stock ledger and the books never disagree.
- Period lock is enforced by a database trigger on every journal entry, not only in screens. Only the owner can move a lock back, with a reason (audit-logged).

## GST assumptions — please confirm
| # | Assumption | Why | Confirm / change |
|---|---|---|---|
| 1 | Place of supply for counter sales = store's state; all sales intra-state (CGST + SGST) | Over-the-counter supply of goods (s.10(1)(c) IGST Act) | Inter-state online deliveries need IGST + B2CL — planned with Sprint 7 |
| 2 | B2C credit notes are netted into B2CS rate-wise; B2B credit notes go to CDNR | Portal practice for unregistered recipients | |
| 3 | Nil-rated medicines (product override 0%) go to Table 8 "Nil rated", not "Exempt" | GST 2.0 notified them at Nil rate | |
| 4 | HSN summary is split B2B / B2C, quantity in the product's base unit; UQC mapped from the unit label (Tab → TBS, ml → MLT, strip → PAC, else OTH) | Phase-III Table 12 changes | Check UQC choice for capsules / strips |
| 5 | GSTR-3B ITC = net input GST in the books for the period (purchases − debit notes + expense bills) | Simple and reconciles with books | Must be matched with **GSTR-2B** before filing; screen says so |
| 6 | If debit notes exceed purchases, the negative ITC is shown as 4(B)(2) reversal | Avoids a negative 4(A) | |
| 7 | Composition traders: 1% (0.5 + 0.5) on turnover of taxable goods; Nil-rated medicines excluded; turnover net of sales returns | Rule 7 CGST Rules as amended for traders | Rate is a parameter if a store is not a trader |
| 8 | Composition: no ITC — expense vouchers refuse input GST lines | s.10(4) | |
| 9 | GSTR-1 JSON has no `version`/`hash`; open it in the GST Offline Tool or upload via "Prepare offline" | Portal schema versions change | Re-validate after every portal schema update |
| 10 | Amendments (B2BA, CDNRA, B2CSA) and e-invoice (IRN) are not generated | R2 scope (UC-GST-05) | Needed once a store crosses the e-invoice threshold |

## Tally export
- Two files: ledger masters (import first) and vouchers. Stock in trade is placed under *Current Assets* so the file imports into an accounts-only company (*Maintain inventory = No*).
- Vouchers carry a fixed GUID (`medstar-<entry id>`), so re-importing an overlapping period with "ignore duplicates" is safe.
- Sales are exported with one line per GST head (not item-wise). Customers with udhaar and suppliers become party ledgers under Sundry Debtors / Creditors.
