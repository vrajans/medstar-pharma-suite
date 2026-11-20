# UAT readiness — end-to-end QA & team sign-off (19-Nov-2026)

Full report with the click-through script: Claude Doc "MedStar UAT readiness — end-to-end QA & team sign-off".

**Verdict:** ready for UAT at one Chennai branch (parallel run with the current software) once migration 0009 is applied and the
click-through script has been run once. The second branch joins after inter-branch stock transfer is built (Sprint 6). Real patient
data waits for the hosted Mumbai environment (Sprint 6); use test data on the laptop setup.

## Evidence
- DB test packs 10–70 pass on Postgres 16 (70 = UAT hardening); 66 core unit tests; typecheck + production build.
- Security audit: RLS on all 47 tables; no function executable by `anon`; role write-rights reviewed table by table.
- Real DB output → GSTR-1 JSON and Tally XML builders: well-formed (not yet loaded in GST Offline Tool / Tally).
- Live click-through: **not done** — the desktop browser pane blocks the app's calls to the local Supabase API (127.0.0.1:54321).

## Defects fixed in this round (migration 20261123000009 + web)
| ID | Sev | Problem → fix |
|---|---|---|
| SEC-03 | High | PIN hashes readable by all staff (offline brute force) → column hidden |
| SEC-02/04 | High | Billing/purchase could add a pharmacist or put one on duty → RPC + PIN only |
| SEC-01 | High | Non-owners could change store rules (presence, GST scheme, GSTIN) → owner/admin |
| ACC-01 | High | GST returns per store; branches under one GSTIN need one return → returns combine all stores sharing the GSTIN |
| PH-01 | High | Drug licence no. missing on bill (D&C r.65) → Form 20/21 numbers + phone printed |
| PM-01 | High | Online orders / Rx verification showed sample data in live mode → hidden until Sprint 7 |
| PM-02 | High | No go-live import of udhaar / supplier dues → Accounts → Opening balances (CSV, dry run, once per party) |
| SEC-05 | Med | Licences editable by billing/purchase → owner/admin |
| SEC-06 | Med | Purchase staff could edit prescription verification → pharmacist/owner/admin |
| SEC-07 | Med | No audit of schedule/HSN/GST-override changes → `product_regulated_change` audit rows |
| SEC-08 | Med | Functions callable by anon; `seed_chart_of_accounts` callable cross-tenant → revoked |
| PM-03 | Med | No duplicate bill reprint → Sales → bill → Print duplicate bill |
| UX-03 | Med | Errors showed paise → rupees via `inr()` |
| UX-04 | Low | Top menu overflow at 1366 px → scrollable |
| UX-05 | Low | Stale "Sprint 1" help text → reworded |

## Open items
1. Inter-branch stock transfer (delivery challan, batch/expiry carried, no GST under one GSTIN, controlled-drug trail) — before branch 2.
2. Live click-through (script in the report) — before UAT day 1.
3. Product master review by the pharmacist: schedules, HSN, 36 Nil-rated drugs at 0%.
4. Confirm one GSTIN for both branches vs separate registrations.
5. CA review of doc 11 assumptions, e-invoice (> ₹5 cr), TDS u/s 194Q (> ₹10 cr) — before the November GSTR-1 (11 Dec).
6. Hosted Supabase (Mumbai) + backups + CERT-In logs — before real data (Sprint 6).
7. Financial-year close — before 1 Apr 2027.
8. Counter hardware per branch (80 mm printer, scanner, silent-print shortcut).
9. Tamil on receipts — after UAT feedback.
