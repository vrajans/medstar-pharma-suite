# MedStar Pharma Suite — Product Requirements & Use-Case Catalogue

Owner: `product-manager` · Detail: `business-analyst` · Validated by: `pharmacy-sme`, `accounting-sme` (see 03-sme-validation.md)
Status: v1.0 baseline · Releases: **MVP** (pilot, 0–4 months), **R2** (4–8 months), **R3** (8–12 months)

## 1. Product vision
One system for an Indian chemist shop (single store or chain) to **sell at the counter and online, buy from distributors, control batch/expiry stock, keep GST-ready books and stay inspection-ready under drug law** — fast enough for a crowded counter and simple enough for a staff member with basic training.

## 2. Personas & roles
| Role | Key permissions |
|---|---|
| Owner / Admin | Everything; settings, users, period lock, licence, price lists |
| Registered Pharmacist | Dispense Rx/H1/X/NDPS, verify online Rx, sign registers, approve substitutions |
| Billing Staff | Create bills, returns within limit, collect payments; no cost price view (configurable) |
| Purchase / Inventory Manager | PO, GRN, expiry returns, stock adjust (with approval), transfers |
| Accountant | Vouchers, bank reconciliation, GST returns, reports; no POS |
| Delivery Rider | Assigned orders, OTP hand-off, COD collection |
| Customer | Storefront account, orders, Rx vault, refills |
| Chain HQ Admin | Multi-store masters, consolidated reports, inter-store transfers |
| Auditor (read-only) | Reports, registers, audit log |

## 3. Modules & use cases
Priority: **M** = Must, **S** = Should, **C** = Could. Each UC has acceptance criteria (AC) in Given/When/Then.

---
### 3.1 Organisation, store & licence setup (ORG)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-ORG-01 | Register organisation (legal name, PAN, GSTIN, GST scheme: Regular/Composition, state) | M | MVP |
| UC-ORG-02 | Add store with address, state code, drug licence numbers (Form 20/21 etc.), licence validity, FSSAI (if selling food supplements) | M | MVP |
| UC-ORG-03 | Register pharmacists (name, State Pharmacy Council reg. no., validity) and map to store & shift | M | MVP |
| UC-ORG-04 | Licence & registration expiry alerts (30/15/7 days) | M | MVP |
| UC-ORG-05 | Users, roles, permission matrix, MFA for Owner/Admin | M | MVP |
| UC-ORG-06 | Invoice series per store per financial year (e.g. `BLR1/26-27/000123`), GST-compliant ≤ 16 chars | M | MVP |
| UC-ORG-07 | Printer & bill format setup (A4, A5, 80 mm, 58 mm), bill footer, terms | M | MVP |
| UC-ORG-08 | Multi-store chain with HQ masters & store overrides | S | R2 |

AC (UC-ORG-04): *Given* a store's retail drug licence expires in 15 days, *when* any Owner logs in, *then* a non-dismissable banner shows licence no. and expiry date, and an email/WhatsApp is sent once.

---
### 3.2 Product master (PRD)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-PRD-01 | Create product: brand name, manufacturer, composition/salt (+strength), dosage form, pack (e.g. 10×15 tablets), HSN, GST rate (via HSN tax table), drug schedule (OTC, G, H, H1, X, C/C1, NDPS), Rx required flag, cold-chain flag, storage condition, barcode(s) | M | MVP |
| UC-PRD-02 | Unit hierarchy & loose sale: Box → Strip → Tablet with conversion factors; sell in any unit; MRP pro-rated | M | MVP |
| UC-PRD-03 | Import master from CSV / standard drug database; dedupe by barcode + name + pack | M | MVP |
| UC-PRD-04 | Search by brand, composition (salt), manufacturer, barcode — typo tolerant, < 150 ms | M | MVP |
| UC-PRD-05 | Generic / substitute suggestion by same composition + strength + form (pharmacist approves) | S | MVP |
| UC-PRD-06 | NPPA/DPCO ceiling price reference per formulation; warn if MRP > ceiling | S | R2 |
| UC-PRD-07 | Banned FDC / NSQ / recall flag at product or batch level → blocks sale | M | MVP |
| UC-PRD-08 | Categories (Rx, OTC, Wellness, FMCG, Surgical, Ayurveda, Devices) for reports and storefront | M | MVP |
| UC-PRD-09 | Storefront content: images, description, "Rx required" badge; Rx-only products not advertised (no price promotion) | M | MVP |
| UC-PRD-10 | Rack/shelf location | S | MVP |
| UC-PRD-11 | Min/max/reorder level per store | M | MVP |

AC (UC-PRD-02): *Given* "Dolo 650" pack 15 tablets/strip, 1 strip/box, MRP ₹30.91/strip, *when* billing 5 tablets, *then* MRP line = ₹10.30 (30.91 × 5/15, rounded to paise) and stock reduces by 5 base units.

---
### 3.3 Customer, doctor & prescription (CRM)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-CRM-01 | Quick-add customer at counter by mobile number (name optional for OTC; mandatory name + address for H1/X/NDPS) | M | MVP |
| UC-CRM-02 | Customer profile: patients/family members, allergies (opt-in), chronic medicines, credit limit, GSTIN (B2B: clinics, hospitals) | M | MVP |
| UC-CRM-03 | Doctor master: name, qualification, registration no. & council, clinic address | M | MVP |
| UC-CRM-04 | Prescription capture: photo/scan, doctor, date, patient, items; link to bill; retained per law | M | MVP |
| UC-CRM-05 | Credit (udhaar) customers: ledger, ageing, limit block, reminders via WhatsApp | M | MVP |
| UC-CRM-06 | Refill reminders for chronic medicines (consented) | S | R2 |
| UC-CRM-07 | Loyalty points / membership pricing | C | R2 |
| UC-CRM-08 | DPDP consent capture & withdrawal; data access/erasure request handling | M | MVP |
| UC-CRM-09 | ABHA (ABDM) linkage and e-prescription pull | C | R3 |

---
### 3.4 Billing — Counter POS (POS)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-POS-01 | Create bill: scan/search → auto-pick batch by **FEFO** (first-expiry-first-out) → qty/unit → discount → payment → print/WhatsApp | M | MVP |
| UC-POS-02 | MRP-inclusive GST back-calculation per line; CGST/SGST split; HSN-wise tax summary on bill | M | MVP |
| UC-POS-03 | Manual batch override (pharmacist/staff with permission) | M | MVP |
| UC-POS-04 | Block expired, recalled, NSQ, quarantined batches; warn near-expiry (< 30 days) | M | MVP |
| UC-POS-05 | Schedule H: Rx reminder & label warning. H1/X/NDPS: mandatory patient name/address, prescriber name & reg. no., Rx image/number → auto-entry in statutory register | M | MVP |
| UC-POS-06 | Pharmacist approval step when Rx drugs present (PIN/biometric) | M | MVP |
| UC-POS-07 | Discounts: line %, bill %, flat; max-discount by role; never sell above MRP; warn below cost | M | MVP |
| UC-POS-08 | Payments: cash (with change), UPI (dynamic QR), card (EDC), credit, wallet, split payment | M | MVP |
| UC-POS-09 | Hold / recall bill; multiple open bills | M | MVP |
| UC-POS-10 | Sales return / exchange against bill (batch-aware, restock or damage) → credit note | M | MVP |
| UC-POS-11 | Bill cancel (same day, with reason & permission) — never delete; reversal entries | M | MVP |
| UC-POS-12 | **Offline billing**: continue when internet is down; sync later without duplicates | M | MVP |
| UC-POS-13 | Keyboard-first (F2 search, F4 customer, F8 pay, F10 save/print, Ctrl+H hold) & barcode scanner | M | MVP |
| UC-POS-14 | Shift open/close: opening cash, cash-in/out, X/Z report, denomination count | M | MVP |
| UC-POS-15 | Composition-scheme stores print "Bill of Supply" without tax; regular print "Tax Invoice" | M | MVP |
| UC-POS-16 | B2B sale to clinic/hospital with buyer GSTIN (e-invoice if org above threshold) | S | R2 |
| UC-POS-17 | Doctor-wise sale tracking (for reports only, no incentives logic) | C | R2 |
| UC-POS-18 | Delivery from counter (phone/WhatsApp order) → assigns to rider | S | MVP |

AC (UC-POS-12): *Given* the POS is offline, *when* staff saves 20 bills, *then* each gets a provisional local number, prints, and on reconnect all 20 post exactly once with final numbers in sequence and stock/ledger updated; a duplicate sync attempt returns the same bill id.

AC (UC-POS-05): *Given* the cart contains an H1 drug, *when* staff presses Save without prescriber reg. no., *then* the save is blocked with message "Schedule H1: prescriber registration number required".

---
### 3.5 Online order portal & order management (OMS)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-OMS-01 | Customer storefront (web + PWA): browse/search, cart, store selection by pincode, delivery or store pickup | M | MVP |
| UC-OMS-02 | Upload prescription (camera/PDF) or choose from Rx vault; "order by prescription" without picking items | M | MVP |
| UC-OMS-03 | OTP login (mobile), addresses, consent | M | MVP |
| UC-OMS-04 | **Pharmacist verification queue**: view Rx, validate doctor/date/patient, map items, approve/reject/partial; mandatory before packing for any Rx item | M | MVP |
| UC-OMS-05 | Block online sale of Schedule X, NDPS & other configured habit-forming drugs (store-pickup with physical Rx only) | M | MVP |
| UC-OMS-06 | Order lifecycle: Placed → Rx Verification → Confirmed → Picking → Packed → Out for delivery → Delivered / Cancelled / Returned | M | MVP |
| UC-OMS-07 | Online payment (UPI/cards/netbanking via gateway), COD, pay-at-pickup; refunds | M | MVP |
| UC-OMS-08 | Online order → same billing engine → Tax invoice generated at packing (batch-wise) | M | MVP |
| UC-OMS-09 | Delivery: assign rider, rider PWA, OTP proof-of-delivery, COD collection reconciliation, cold-chain packaging flag | M | MVP |
| UC-OMS-10 | Notifications: WhatsApp/SMS/email at each status | M | MVP |
| UC-OMS-11 | Real-time order alert at store (sound + Realtime) | M | MVP |
| UC-OMS-12 | Serviceable pincodes & delivery charges per store | M | MVP |
| UC-OMS-13 | Out-of-stock handling: substitute (with pharmacist + customer consent), partial fulfil, transfer from sister store | S | R2 |
| UC-OMS-14 | Reorder past order / refill subscription | S | R2 |
| UC-OMS-15 | Integrations with aggregators (ONDC seller app) | C | R3 |

AC (UC-OMS-04): *Given* an online order with an H drug, *when* packer tries to move it to Picking before pharmacist approval, *then* the transition is rejected by the database.

---
### 3.6 Purchase (PUR)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-PUR-01 | Distributor master: GSTIN (validated), drug licence no., state, credit days, contact | M | MVP |
| UC-PUR-02 | Auto purchase suggestion (reorder level, sales velocity, pending orders) | M | MVP |
| UC-PUR-03 | Purchase order → send by WhatsApp/email/PDF | M | MVP |
| UC-PUR-04 | Goods receipt / purchase invoice entry: batch, expiry, MRP, PTR, PTS, free qty (scheme), discount, GST (CGST/SGST or IGST) | M | MVP |
| UC-PUR-05 | Import distributor invoice (CSV / standard pharma e-invoice formats) to avoid typing | S | MVP |
| UC-PUR-06 | Validate: MRP change vs last batch, PTR > MRP, expiry < 3 months, invoice total vs computed | M | MVP |
| UC-PUR-07 | Purchase return / expiry & breakage return to distributor → debit note | M | MVP |
| UC-PUR-08 | Near-expiry return planning (distributor claim window) | S | R2 |
| UC-PUR-09 | Payables: distributor ledger, ageing, payment entry, cheque/NEFT/UPI | M | MVP |
| UC-PUR-10 | ITC reconciliation with GSTR-2B | S | R2 |
| UC-PUR-11 | TDS 194Q / TCS applicability (by threshold) | S | R2 |

---
### 3.7 Inventory (INV)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-INV-01 | Batch-wise stock (qty in base units, expiry, MRP, cost) per store, real time | M | MVP |
| UC-INV-02 | Stock ledger (append-only): every movement with document reference | M | MVP |
| UC-INV-03 | Expiry dashboard: expired, 30/60/90 days, value at cost | M | MVP |
| UC-INV-04 | Stock adjustment (damage, breakage, theft, audit diff) with reason & approval | M | MVP |
| UC-INV-05 | Physical stock audit (cycle count by rack) with mobile scanning | S | R2 |
| UC-INV-06 | Inter-store stock transfer (delivery challan / e-way bill if > ₹50,000) | S | R2 |
| UC-INV-07 | Batch recall: mark batch → quarantine → find customers who bought it | M | MVP |
| UC-INV-08 | Cold-chain item temperature log (manual R2, IoT R3) | S | R2 |
| UC-INV-09 | Opening stock import with batch/expiry | M | MVP |
| UC-INV-10 | Dead / slow-moving stock report | M | MVP |

---
### 3.8 Accounting (ACC)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-ACC-01 | Default chart of accounts for a pharmacy (Cash, Bank, UPI clearing, Card clearing, Sales 0%/5%/18%, Output CGST/SGST/IGST, Input GST, Purchases, Stock, COGS, Discount, Round-off, Expiry loss, Debtors, Creditors, Capital, Expenses) | M | MVP |
| UC-ACC-02 | Auto journal for every sale, return, purchase, debit/credit note, payment, receipt, stock adjustment | M | MVP |
| UC-ACC-03 | Manual vouchers: payment, receipt, contra, journal, expense with attachment | M | MVP |
| UC-ACC-04 | Day book, cash book, bank book, ledger, trial balance | M | MVP |
| UC-ACC-05 | Bank reconciliation (statement import CSV) | S | R2 |
| UC-ACC-06 | P&L, balance sheet, gross margin by product/category/brand | M | MVP |
| UC-ACC-07 | Period lock (month/FY); edits after lock only via reversal by Admin | M | MVP |
| UC-ACC-08 | Financial-year close and opening balances carry forward | M | R2 |
| UC-ACC-09 | Tally export (XML) / CA access | S | MVP |
| UC-ACC-10 | Expense management & petty cash | S | MVP |
| UC-ACC-11 | Payment gateway & UPI settlement reconciliation | S | R2 |

---
### 3.9 GST & tax compliance (GST)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-GST-01 | Effective-dated HSN → GST rate table (Nil / 5% / 18% / 40%) updatable without code release | M | MVP |
| UC-GST-02 | GSTR-1 data: B2B, B2CS, CDNR, HSN summary, document summary; JSON for offline tool | M | MVP |
| UC-GST-03 | GSTR-3B summary | M | MVP |
| UC-GST-04 | Composition: CMP-08 quarterly, GSTR-4 annual summary | M | MVP |
| UC-GST-05 | E-invoice (IRN/QR) for B2B when applicable | S | R2 |
| UC-GST-06 | E-way bill generation for transfers / bulk B2B | S | R2 |
| UC-GST-07 | GSTIN validation (format + checksum; API lookup R2) | M | MVP |

---
### 3.10 Drug-law compliance (CMP)
| ID | Use case | Pri | Rel |
|---|---|---|---|
| UC-CMP-01 | Schedule H1 register (auto from bills): date, patient name & address, prescriber name & address/reg. no., drug & quantity, batch, bill no. Retain ≥ 3 years. Print/export | M | MVP |
| UC-CMP-02 | Schedule X register & prescription copy retention (≥ 2 years); stock reconciliation | M | MVP |
| UC-CMP-03 | NDPS register (receipt & sale) per state format; stock balance | M | MVP |
| UC-CMP-04 | Prescription archive searchable by patient/doctor/date | M | MVP |
| UC-CMP-05 | Pharmacist-on-duty log; Rx sales only while a registered pharmacist is clocked in (configurable hard/soft block) | M | MVP |
| UC-CMP-06 | Purchase records with distributor licence numbers (inspection-ready) | M | MVP |
| UC-CMP-07 | Recall / NSQ alert ingestion (manual upload R1, CDSCO feed R3) | M | MVP |
| UC-CMP-08 | Inspection pack: one-click PDF of registers, licences, pharmacist list, purchase & sale records for a date range | S | R2 |
| UC-CMP-09 | Immutable audit log of all sensitive actions (price override, cancel, register edit, Rx view) | M | MVP |
| UC-CMP-10 | Sales-pattern alerts for habit-forming drugs (e.g. repeated codeine syrup purchases) | S | R2 |

---
### 3.11 Reports & dashboards (RPT)
Daily sales summary, payment-mode summary, shift report, top products, margin report, expiry report, stock valuation, purchase register, sales register, debtor/creditor ageing, online order funnel, pharmacist verification SLA, GST reports, compliance registers. MVP: owner dashboard (today's sales, cash in hand, online orders pending, items to reorder, expiring this month, licences expiring).

### 3.12 Platform (PLT)
UC-PLT-01 Multi-tenant SaaS with RLS · UC-PLT-02 Subscription & billing of the product itself (R2) · UC-PLT-03 Data import/export · UC-PLT-04 Backup & restore per tenant · UC-PLT-05 Notifications service (WhatsApp/SMS/email) · UC-PLT-06 Audit & activity log · UC-PLT-07 Localisation (EN, HI R2).

## 4. Key business rules (summary)
1. Selling price ≤ MRP of the batch, always.
2. Expired / recalled / NSQ / quarantined batch can never be billed.
3. Default batch selection = FEFO, then FIFO by receipt date.
4. Tax is back-calculated from MRP-inclusive price; rounding to paise per line, bill round-off to nearest rupee posted to Round-off ledger.
5. Rx-required items need a pharmacist approval on the bill; H1/X/NDPS need full register data.
6. Online orders with Rx items cannot proceed past "Rx Verification" without pharmacist approval; Schedule X/NDPS never ship.
7. Documents are never deleted; cancellation and correction are reversals.
8. Invoice numbering is gap-free per series per FY at the server (offline bills get provisional numbers).

## 5. Non-functional requirements
- POS search p95 < 150 ms; bill save local < 300 ms; server post < 800 ms.
- Offline for ≥ 72 hours / 2,000 bills.
- 99.9 % uptime for API; data in India (ap-south-1).
- Runs on Chrome on Windows 10, 4 GB RAM; storefront on Android Go devices.
- DPDP Act 2023 compliant; OWASP ASVS L2.
