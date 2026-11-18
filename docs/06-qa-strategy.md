# QA Strategy & Test Packs

Owner: `qa-lead`

## 1. Test pyramid
- **Unit (Vitest)** — packages/core: GST back-calc, rounding, FEFO, unit conversion, schedule rules, invoice numbering. Target ≥ 95 % lines.
- **DB (pgTAP / SQL)** — RLS isolation per table, posting functions balance, append-only enforcement, H1 register row creation.
- **Integration** — Edge Functions with mocked gateway/WhatsApp; webhook signature checks.
- **E2E (Playwright)** — POS bill, H1 bill, return, offline bill & sync, GRN, online order end-to-end, rider OTP.
- **Non-functional** — k6 load (500 concurrent POS), Lighthouse storefront (≥ 90 perf on Moto G profile), OWASP ZAP baseline, accessibility (axe).

## 2. Mandatory compliance test pack (sample)
| ID | UC | Given / When / Then |
|---|---|---|
| T-CMP-001 | POS-05 | H1 item, no prescriber reg. → save blocked |
| T-CMP-002 | CMP-01 | H1 bill saved → register row with patient, prescriber, drug, qty, batch, bill no. |
| T-CMP-003 | OMS-05 | Schedule X item in online cart → cannot checkout for delivery |
| T-CMP-004 | OMS-04 | Rx order → status update to `picking` without approval → DB error |
| T-CMP-005 | POS-04 | Expired batch scanned → not added, audible alert |
| T-CMP-006 | INV-07 | Recalled batch → hidden from FEFO and blocked; recall report lists buyers |
| T-CMP-007 | CMP-09 | Register row UPDATE by authenticated user → permission denied |

## 3. Billing math pack (sample)
| ID | Case | Expected |
|---|---|---|
| T-BIL-001 | MRP ₹105.00 @5 % qty 1 | taxable 100.00, CGST 2.50, SGST 2.50 |
| T-BIL-002 | MRP ₹30.91/strip of 15, sell 5 tabs | line ₹10.30 |
| T-BIL-003 | 10 % discount on ₹119.50 @5 % | amount 107.55, taxable 102.43, tax 5.12 |
| T-BIL-004 | Nil-rated life-saving drug | tax 0, shown under Nil in HSN summary |
| T-BIL-005 | Bill total ₹190.63 | round-off +0.37 → ₹191.00 |
| T-BIL-006 | Price > MRP | rejected |
| T-BIL-007 | Composition store | Bill of Supply, no tax lines |

## 4. Accounting invariants (run nightly in staging)
Every `journal_entry` balances (Σdr = Σcr) · trial balance nets to 0 · stock ledger qty = batch on-hand · sales register total = GSTR-1 B2CS + B2B totals.

## 5. UAT
3 pilot pharmacies (1 single store urban, 1 tier-2 with frequent outages, 1 small chain), 2 weeks parallel run vs existing software, exit criteria: zero S1, < 5 S2, daily closing matches cash count.
