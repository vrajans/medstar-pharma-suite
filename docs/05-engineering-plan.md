# Engineering Plan — Team, Epics, Sprints

Owner: `engineering-manager`

## 1. Team (MVP)
| Role | Count | Agent |
|---|---|---|
| CTO | 1 | cto |
| Engineering Manager | 1 | engineering-manager |
| Product Manager + BA | 1 + 1 | product-manager, business-analyst |
| UX Manager + UI Designer | 1 + 1 | ux-manager, ui-designer |
| Front-end engineers | 3 | frontend-engineer |
| Back-end / DB engineers | 2 + 1 | backend-engineer, database-engineer |
| DevOps/SRE | 1 (shared) | devops-engineer |
| QA (1 lead + 1 automation) | 2 | qa-lead |
| SMEs (part-time) | Pharmacist + CA | pharmacy-sme, accounting-sme |
| Security & privacy (part-time) | 1 | security-privacy |
| Customer success / onboarding | 1 (from S6) | customer-success |

## 2. Epics (MVP)
E1 Platform & auth & tenancy · E2 Product master & import · E3 Inventory & batches · E4 POS billing (online) · E5 POS offline & sync · E6 Purchase & GRN & returns · E7 Accounting auto-posting & reports · E8 GST reports · E9 Compliance registers & audit · E10 Storefront & Rx upload · E11 OMS, Rx verification, delivery · E12 Payments & notifications · E13 Migration & onboarding

## 3. Sprint plan (2-week sprints; re-planned 19-Nov-2026 after S1–S2 delivered GRN, live POS and offline sync early)
| Sprint | Goal | Stories (UC refs) |
|---|---|---|
| S1 ✅ | Foundations (done 18-Nov-2026: auth, onboarding, roles/invites, pharmacists+PIN+shifts, licence alerts, live POS with offline cache & PIN approvals) | Monorepo, CI, Supabase envs, schema v1, RLS, auth, org/store/user (ORG-01..05), packages/core GST + money |
| S2 ✅ | Masters + purchase basics (done 19-Nov-2026: product master & CSV import, Nil-rate override, distributors & payables, GRN screen, opening stock import, customers/doctors, credit sales & receipts) | Product master + units + HSN tax table (PRD-01..04, 08, 11, GST-01), doctor & customer (CRM-01..03), import CSV |
| S3 ✅ | Returns & adjustments (done 20-Nov-2026: credit notes, same-day cancel, debit notes, approvals, recalls with customer trace) | Sales return/exchange + credit notes (POS-10), same-day bill cancel with reversal (POS-11), purchase & expiry returns + debit notes (PUR-07), stock adjustments with approval (INV-04), recall screen (INV-07) |
| S4 ✅ | Counter hardening & registers (done 21-Nov-2026: cash shifts & X/Z reports, offline app shell, silent printing, registers & exports, controlled-drug reconciliation, Rx archive, audit viewer) | Shift open/close + cash count (POS-14), service-worker offline app shell, silent printing, live H1/X/NDPS register screens + PDF/CSV export (CMP-01..04), audit-log viewer (CMP-09) |
| S5 ✅ | Accounting & GST (done 22-Nov-2026: ledgers & vouchers with attachments, period lock on every posting, day book / ledgers / TB / P&L + margin / balance sheet, GSTR-1 JSON, GSTR-3B with set-off, CMP-08 / GSTR-4, Tally XML) | Vouchers & expenses (ACC-03, 10), day book/ledgers/trial balance/P&L (ACC-04, 06), period lock UI (ACC-07), GSTR-1/3B/CMP-08 exports incl. credit/debit notes (GST-02..04), Tally XML (ACC-09) |
| S5.1 ✅ | End-to-end QA & UAT hardening (done 19-Nov-2026: 15 defects fixed — security, combined GST per GSTIN, DL no. on bill, opening balances, duplicate bill; see 12-uat-qa-signoff.md) | QA sign-off by every role |
| S6 | UAT readiness | **Inter-branch stock transfer (first)**, production setup, CERT-In log drain, security tests, onboarding toolkit, pilot parallel run (see 09-production-uat-readiness.md) |
| S7 | Online orders live | Storefront on live data, Rx upload to storage, OTP login, verification queue, order lifecycle, Realtime alert (OMS-01..08, 10..12) |
| S8 | Payments & last mile | Payment gateway, WhatsApp/SMS Edge Functions, rider PWA, COD reconciliation (OMS-07, 09, 10) |

## 4. Definition of Done
Code reviewed · unit tests (core ≥ 95 %) · Playwright flow · migration + RLS test · docs/data-dictionary updated · QA pass · SME sign-off for regulated stories · feature flag for pilot.

## 5. Risk register
| Risk | P | I | Owner | Mitigation |
|---|---|---|---|---|
| Offline sync bugs | M | H | FE lead | Property-based tests, chaos test (kill network mid-sync) |
| Compliance misinterpretation | M | H | PM | SME sign-off gate, state templates |
| Hardware (printers) | H | M | FE | Certified list, browser print fallback |
| Scope creep | H | M | EM | Roadmap "Not now" list |
| E-pharmacy regulation change | M | H | CTO/PM | Rules engine for online restrictions; flags per state |
