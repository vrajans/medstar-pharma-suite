# SME Validation Report — v1.0

Reviewers: `pharmacy-sme` (drug law & retail practice), `accounting-sme` (GST & accounting), `security-privacy` (DPDP)
Input reviewed: founder scope ("product, customer, billing, purchase, inventory, accounting & compliance — schedule drugs, online order integration") and 02-prd-use-cases.md.

Legend: ✅ correct · ⚠️ needs change · ❌ non-compliant as stated · ➕ missing (added to PRD)

> Not legal advice. Items marked **[verify per state]** vary by State Drugs Control / FDA and must be confirmed with a local consultant before go-live in that state.

## A. Features MISSING from the original scope (now added)

| # | Missing feature | Why it matters | Added as |
|---|---|---|---|
| 1 | **Batch & expiry at every movement** (not just product-level stock) | Pharmacy stock is legally and financially batch-wise; recalls and expiry returns are per batch | UC-INV-01/02, UC-POS-01 |
| 2 | **Loose / strip sale with unit conversion** | Most Indian bills sell strips or tablets from a box | UC-PRD-02 |
| 3 | **Pharmacist-on-duty & registered pharmacist master** | Pharmacy Act 1948 / Pharmacy Practice Regulations 2015: dispensing by registered pharmacist | UC-ORG-03, UC-CMP-05 |
| 4 | **Drug licence & licence-expiry tracking** (store and distributor) | Buying from an unlicensed distributor or selling on an expired licence is an offence | UC-ORG-02/04, UC-PUR-01 |
| 5 | **Doctor master with registration number** | Required for H1/X/NDPS registers | UC-CRM-03 |
| 6 | **Statutory registers** (H1, X, NDPS) auto-generated, retained 3 / 2 years | Inspection requirement | UC-CMP-01..03 |
| 7 | **Online Rx verification by pharmacist before dispatch** | No Rx drug may be sold without a valid prescription; core e-pharmacy risk (fake/AI prescriptions reported in 2026) | UC-OMS-04 |
| 8 | **Hard block on online sale of Schedule X / NDPS / habit-forming** | Draft e-Pharmacy Rules 2018 and general enforcement stance | UC-OMS-05 |
| 9 | **Recall / NSQ / banned FDC blocking** | CDSCO monthly NSQ alerts; banned FDC notifications | UC-PRD-07, UC-INV-07, UC-CMP-07 |
| 10 | **MRP ceiling & DPCO/NPPA price check** | Selling above MRP / ceiling is an offence under DPCO 2013 | UC-PRD-06, rule 4.1 |
| 11 | **Expiry & breakage returns to distributor (debit notes)** | 2–5 % of pharmacy margin is lost to expiry without it | UC-PUR-07/08 |
| 12 | **Free quantity / scheme handling, PTR/PTS** | Standard pharma purchase terms; affects cost & margin | UC-PUR-04 |
| 13 | **Credit (udhaar) ledger & ageing** | Very common in neighbourhood pharmacies | UC-CRM-05 |
| 14 | **Composition-scheme support** | Many small chemists are composition dealers: Bill of Supply, CMP-08, GSTR-4 | UC-POS-15, UC-GST-04 |
| 15 | **Effective-dated GST rate table** | Rates changed on 22 Sep 2025 (most medicines 12 % → 5 %, 36 life-saving drugs Nil); will change again | UC-GST-01 |
| 16 | **Offline billing** | Connectivity outages are routine in tier-2/3 towns | UC-POS-12 |
| 17 | **Shift / cash closing** | Cash leakage control | UC-POS-14 |
| 18 | **Cold-chain flag & packaging for delivery** | Insulin, vaccines, some biologicals (Schedule C/C1) | UC-PRD-01, UC-OMS-09, UC-INV-08 |
| 19 | **Delivery & rider workflow with COD reconciliation** | Online order is incomplete without last mile | UC-OMS-09 |
| 20 | **DPDP consent, notices, erasure handling** | DPDP Rules 2025 notified 13 Nov 2025; prescriptions are sensitive health data | UC-CRM-08 |
| 21 | **Immutable audit log & period lock** | Fraud control; Companies Act audit-trail expectations; GST audits | UC-CMP-09, UC-ACC-07 |
| 22 | **Data migration from Marg / GoFrugal / Tally / Excel** | Every customer is switching from something | customer-success plan |
| 23 | **Substitution / generic suggestion with pharmacist approval** | Jan Aushadhi / generic push; stock-out handling | UC-PRD-05, UC-OMS-13 |
| 24 | **Habit-forming drug sale-pattern alerts** | Codeine/tramadol/alprazolam misuse; inspector focus | UC-CMP-10 |

## B. Validation of core rules

| Area | Rule in PRD | Verdict | Notes |
|---|---|---|---|
| H1 register fields | patient name & address, prescriber name & address, drug name & qty, retain 3 yrs | ✅ | Add batch & bill no. for traceability (done). |
| Schedule X | Rx in duplicate, retain copy, register, retain 2 yrs | ✅ | Separate locked storage — process, not software. Separate licence endorsement **[verify per state]**. |
| NDPS | separate register | ⚠️ | Formats differ by state; make register columns configurable per state template. |
| Schedule H label | "Rx only" warning | ✅ | Show on bill line + storefront product page. |
| Pharmacist block | Rx sale only if pharmacist clocked in | ⚠️ | Make **configurable** (hard/soft) — owner is often the pharmacist; log every override. |
| Online Rx validity | doctor name, reg. no., date, patient | ⚠️ | Add Rx age limit setting (default 6 months, chronic 12) and "Rx used N times" counter to stop reuse for H1. |
| Delivery geography | within licensed premises' area | ⚠️ | State licences are premises-bound; restrict serviceable pincodes per store; no inter-state shipping of Rx drugs **[verify]**. |
| Advertising | Rx drugs not promoted | ✅ | Storefront: no discount banners on Rx items; OTC allowed. |
| Price | ≤ MRP, batch-wise MRP | ✅ | |
| GST rates | Nil / 5 % / 18 % via HSN table | ✅ | Seed data reflects 22-Sep-2025 rates; CA to re-verify each quarter. |
| GST back-calculation | taxable = MRP × 100 / (100+r) | ✅ | Round per line to 2 dp; CGST = SGST = tax/2, put odd paisa on SGST consistently. |
| Discount & tax | discount reduces taxable value | ✅ | Discount shown on invoice is pre-tax-adjusted (included in value). |
| Free goods on purchase | qty at zero value, cost averaged across batch | ✅ | Effective cost = net amount / (qty + free). |
| Composition | no tax collected, Bill of Supply | ✅ | Composition dealers can't make inter-state outward supplies or supply via e-commerce operators — warn if online portal enabled via third-party marketplace. |
| E-invoice | B2B only, by AATO threshold | ✅ | Not applicable to B2C retail bills. |
| E-way bill | > ₹50,000 consignment, incl. branch transfers | ✅ | |
| TCS (GST s.52) | own website | ✅ | Not applicable when the pharmacy sells through its own portal; applicable only if a marketplace operator collects. |
| Journal | double-entry, auto-posted, append-only | ✅ | |
| Period lock | | ✅ | |
| DPDP retention vs erasure | | ⚠️ | Statutory retention (registers, GST books) overrides erasure — state in privacy notice; erase marketing/profile data. |

## C. Open items for founders / legal
1. ❓ OPEN: Target launch states — needed to finalise NDPS register templates and Schedule X licence checks.
2. ❓ OPEN: Will the portal ever list on aggregators/ONDC? (affects composition dealers and TCS).
3. ❓ OPEN: Teleconsultation / e-prescription partner (ABDM) — R3 scope.
4. ❓ OPEN: Written legal opinion on e-pharmacy model (Draft Rules 2018 still unnotified as of 2026; chemist associations actively protesting online sale) before marketing the online module.
