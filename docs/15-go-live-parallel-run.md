# Go-live plan — parallel run at the two Chennai branches

Owner: `customer-success` · With: `product-manager`, `pharmacy-sme`, `accounting-sme`, `qa-lead`

**Goal:** both branches bill every sale in MedStar for 2 weeks while the current POS stays the system of record. Switch off the old POS
only when the exit criteria below hold for 5 business days in a row.

## Week 0 — set up (owner + one admin, after the hosting runbook)
| Day | Task | Done when |
|---|---|---|
| D-5 | Export from the current POS: item master, batch-wise closing stock, customer outstanding, supplier outstanding, doctor list | 5 files saved |
| D-4 | Map the item master to `samples/products-sample.csv` columns; pharmacist checks schedule (H/H1/X/NDPS), HSN, Nil-rated (0%) | Products → Import shows 0 errors |
| D-3 | Add suppliers (name, GSTIN, drug licence, credit days); pharmacists with PINs; Form 20/21 licences per branch; users and roles | Settings complete for both branches |
| D-2 | Opening stock per branch (Inventory → Load opening stock) from the closing-stock export of the **same evening** | Stock value matches the old POS within 1% |
| D-2 | Opening balances (Accounts → Opening balances): customer udhaar + supplier dues; journal voucher for cash and bank | Trial balance balances; totals match old POS |
| D-1 | Counter PCs: Chrome, POS shortcut, printer test, scanner test; staff training (45 min per role, docs/14 section 3) | Every user signed in once and billed a test item |

## Weeks 1–2 — parallel run (every day)
1. Bill every sale in **both** systems (or bill in MedStar and re-key into the old POS at the end of the day if the counter is too busy — agree per branch).
2. End of day, per branch: compare in a shared sheet — bills count, sales total, cash counted, UPI total, udhaar given. Differences above ₹50 get a line of explanation.
3. GRNs and returns entered in both. Transfers between branches only through MedStar (challan travels with the goods).
4. 15-minute call each evening with the branch in-charge: blockers, missing features, wrong data. Log them in the issue tracker the same day.

## Exit criteria (switch off the old POS)
- 5 consecutive business days with daily totals matching within ₹50 per branch, no unexplained difference.
- Stock check of 30 random items per branch matches MedStar.
- H1 register printed from MedStar accepted by the pharmacist; GSTR-1 JSON for the month opens in the GST Offline Tool.
- No open "blocker" issues; every user can bill, return and close a shift without help.
- Hosting: health monitor green for 7 days, one backup restore tested.

## Roles during the pilot
| Who | Does |
|---|---|
| Owner | Daily comparison sign-off, decisions on blockers |
| Branch in-charge (each branch) | Fills the end-of-day comparison, gathers staff feedback |
| Pharmacist | Rx approvals, registers, transfer receipts |
| MedStar team (you + Claude) | Fixes within 24 h for blockers, weekly release outside rush hours |

## When something breaks at the counter
1. Internet down: keep billing — the POS works offline and syncs later (bills show a provisional number until then).
2. App won't open: use the old POS for that day (it is still running) and report it.
3. Wrong price / GST / schedule: fix the product master (owner or pharmacist), the change is audit-logged.
4. Anything else: screenshot + time + branch to the support WhatsApp group.
