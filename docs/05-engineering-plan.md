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

## 3. Sprint plan (2-week sprints, 8 sprints ≈ 4 months to pilot)
| Sprint | Goal | Stories (UC refs) |
|---|---|---|
| S1 ✅ | Foundations (done 18-Nov-2026: auth, onboarding, roles/invites, pharmacists+PIN+shifts, licence alerts, live POS with offline cache & PIN approvals) | Monorepo, CI, Supabase envs, schema v1, RLS, auth, org/store/user (ORG-01..05), packages/core GST + money |
| S2 | Masters | Product master + units + HSN tax table (PRD-01..04, 08, 11, GST-01), doctor & customer (CRM-01..03), import CSV |
| S3 | Stock & purchase | Distributor master, GRN with batch/free/PTR (PUR-01, 04, 06), stock ledger (INV-01, 02, 09) |
| S4 | POS v1 | Bill with FEFO, tax, discounts, payments, print (POS-01..04, 07..09, 13, 15) + journal auto-post (ACC-01, 02) |
| S5 | Compliance & returns | H/H1/X/NDPS capture, registers, pharmacist approval (POS-05, 06, CMP-01..05, 09), returns/cancel (POS-10, 11), purchase returns (PUR-07) |
| S6 | Offline + shifts | Dexie outbox, sync, provisional numbers (POS-12), shifts (POS-14), expiry dashboard, recall (INV-03, 07) |
| S7 | Online orders | Storefront, Rx upload, OTP, cart/checkout, verification queue, lifecycle, Realtime alert (OMS-01..08, 10..12) |
| S8 | Money & hardening | Payment gateway, rider PWA, COD (OMS-07, 09), GSTR-1/3B/CMP-08 (GST-02..04), ledgers/TB/P&L (ACC-03..07), Tally export, perf + security test, pilot onboarding |

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
