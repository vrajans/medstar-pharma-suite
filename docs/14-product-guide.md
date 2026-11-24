# MedStar Pharma Suite — what it does today, where to find it, what is not there yet

For the owner, branch staff and the first customer. Version: Sprint 6 (Nov 2026). Share this before the parallel run so nobody is surprised.

## 1. Feature list by area
| Area | What you can do | Where |
|---|---|---|
| **Counter billing** | Keyboard billing (F2 search by brand / salt / barcode, ↑↓ Enter, F8 payment mode, F4 customer, Ctrl+R prescription, F10 save); strips or loose tablets; batch picked by earliest expiry (FEFO), expired / recalled batches blocked; line and bill discount within each user's limit; cash / UPI / card / credit (udhaar) / split; GST-inclusive MRP with correct CGST/SGST; 80 mm receipt with GSTIN, DL number, batch, expiry; **A4 tax invoice** for clinics; **WhatsApp bill** to the customer; works **offline** and syncs with proper numbers | POS |
| **Prescription drugs** | Schedule H / H1 / X / NDPS need a registered pharmacist on duty and their PIN; H1/X capture patient, doctor and registration number; prescription photo; 5 wrong PINs lock for 15 minutes | POS |
| **Cash shifts** | Open with float, cash in/out with reason, X report any time, close with note-by-note count; shortage over ₹100 needs a note | POS → shift panel |
| **Bills after the sale** | Search bills, **duplicate bill**, A4 invoice, WhatsApp, return items (credit note, refund mode), same-day cancel by the biller within 30 min or by the owner | Sales |
| **Customers & doctors** | Customer master with mobile, GSTIN, credit limit; udhaar receipts; doctor master | Customers, Doctors |
| **Products** | Product master with salt, schedule, HSN, pack/loose units, barcodes, rack, reorder level, GST override (Nil-rated drugs); CSV import with row-level errors | Products |
| **Purchases** | GRN from the supplier invoice with free quantity (scheme), discount, batch, expiry, MRP; supplier dues and payments; returns / expiry returns with debit note; **short list** of what to reorder and **purchase orders** (print / WhatsApp to the supplier) | Purchase, Purchase → Short list & orders |
| **Inventory** | Batch-wise stock with expiry colours, near-expiry and blocked views, stock adjustments with approval, recalls with the list of customers who bought the batch, opening stock import; **branch transfers** with delivery challan, in-transit, short receipt, cancel | Inventory, Inventory → Branch transfers |
| **Reports** | Sales summary by day / payment mode / staff / hour; item-wise sales with margin; doctor-wise; purchase register; customer udhaar with **WhatsApp reminder**; supplier dues with overdue; stock valuation at cost and MRP; non-moving stock — all export to CSV / print | Reports |
| **Accounts** | Books kept automatically; payment / receipt / contra / journal / expense vouchers with bill photo; day book, cash and bank book, party ledgers, trial balance, P&L with margin, balance sheet; opening balances import; period lock; Tally export | Accounts |
| **GST** | GSTR-1 (portal JSON), GSTR-3B with set-off and books check, CMP-08 / GSTR-4 for composition; one combined return for branches under one GSTIN; rate table with GST 2.0 dates | GST |
| **Compliance** | H1 / X / NDPS registers (print / CSV), controlled-drug stock reconciliation, prescription archive (every view logged), audit log, licence expiry alerts on the dashboard | Compliance, Dashboard |
| **Users & branches** | Roles: owner, admin, pharmacist, billing, purchase, accountant, auditor; staff limited to their branches; invites; multiple branches with their own bill series | Settings |

## 2. Not available yet — say this up front
| Not yet | Planned | What to do meanwhile |
|---|---|---|
| Online orders, customer app/website, home delivery | Sprint 7 | Phone/WhatsApp orders billed at the counter |
| Payment links / UPI QR auto-confirmation, automatic WhatsApp/SMS sending | Sprint 8 | WhatsApp buttons open the message; staff press send. UPI paid at counter, enter reference |
| Transfers between branches with **different GSTINs** (needs a tax invoice) | Later | Bill it as a B2B sale from one branch to the other |
| Import of the distributor's invoice file (CSV/Excel) into GRN | Next after pilot | Type the GRN (scheme and discount fields are on the screen) |
| Barcode label printing | Later | Use the manufacturer barcode; search by name works |
| Year-end closing (carry forward to FY 2027-28) | Before 1 Apr 2027 | Nothing needed until March |
| Bank reconciliation, e-invoice (IRN), e-way bill | R2 | Done by the CA if needed (e-invoice only above ₹5 crore B2B turnover) |
| Loyalty points, schemes for customers | R2 | Use bill discount within limits |
| Tamil on screens and receipts | After pilot feedback | — |

## 3. One-page guides by role
**Billing staff** — Sign in → POS → if no shift is open, open it with the float. Bill with F2 → Enter → quantity → F10. Prescription item: ask the pharmacist for PIN. Udhaar: F4 customer, payment mode credit. End of day: Close shift, count notes, print Z report. Lost bill: Sales → bill → Duplicate.

**Pharmacist** — Start duty in POS with your PIN at the start of your shift and end it when you leave. Approve H/H1/X/NDPS lines with your PIN only after seeing the prescription. Receive branch transfers (Inventory → Branch transfers) and check controlled-drug quantities against the challan. Weekly: Compliance → Controlled reconciliation; Reports → Non-moving stock.

**Purchase** — Purchase → Short list & orders → create orders per supplier → WhatsApp. When goods arrive: New GRN from the invoice. Expiry returns: Purchase → Returns. Keep supplier drug licences current (purchases are blocked after expiry).

**Accountant** — Daily: Reports → Sales summary vs cash in hand. Expenses as vouchers with the bill photo. Monthly: GST → GSTR-1 JSON, GSTR-3B (match with GSTR-2B), then Accounts → Period lock. Tally export for the CA.

**Owner** — Dashboard every morning (expiry, licences, today's sales). Reports → Sales summary by staff and hour. Settings: users, roles, discount limits, branches. Only the owner can unlock a locked month.
