# UI/UX Design — Information Architecture, Journeys, Wireframes

Owner: `ux-manager` · Build: `ui-designer`

## 1. Apps & sitemap
**A. Back-office + POS (apps/web)** — `/pos` · `/orders` (online queue) · `/rx-verify` · `/products` · `/customers` · `/doctors` · `/purchase` (PO, GRN, returns) · `/inventory` (stock, expiry, adjust, transfer, recall) · `/accounts` (vouchers, ledgers, TB, P&L) · `/gst` · `/compliance` (H1, X, NDPS, Rx archive, audit log, licences) · `/reports` · `/settings`
**B. Storefront (apps/storefront)** — `/` · `/search` · `/p/[slug]` · `/cart` · `/upload-rx` · `/checkout` · `/orders/[id]` · `/account` (addresses, Rx vault, consents)
**C. Rider PWA (R1 inside apps/web `/rider`)** — assigned orders · navigate · OTP hand-off · COD

## 2. POS wireframe (1366×768, keyboard-first)
```
┌ MedStar POS ─ Store BLR1 ─ Shift #42 (Ravi) ─ Pharmacist: Dr. A. Rao ✅ ─ ● Online ┐
│ [F2] Search / scan: dolo█                                         [F4] Customer: 98xxxx1234 Meena │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ # Item              Sch  Batch    Exp    Unit   Qty   MRP     Disc%  Amount         │
│ 1 Dolo 650 Tab      —    DL2405   08/27  Strip  2     30.91   0      61.82          │
│ 2 Azithral 500      H    AZ1123   03/27  Strip  1     119.50  10     107.55         │
│ 3 Alprax 0.25       H1⚠  AX0912   11/26* Strip  1     22.00   0      22.00          │
│   ⚠ H1: prescriber reg. no. + patient address required  [Ctrl+R] Add Rx             │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Items 3 · Taxable 182.26 · CGST 4.55 · SGST 4.56 · Round-off −0.37 ·  TOTAL ₹191.00  │
│ [F8] Pay: Cash | UPI | Card | Credit | Split     [Ctrl+H] Hold  [F10] Save & Print   │
└─────────────────────────────────────────────────────────────────────────────────────┘
 * near-expiry highlighted amber; expired rows cannot be added (red toast, scanner beep)
```

## 3. Pharmacist Rx verification (tablet)
Left: zoomable Rx image (rotate, enhance). Right: checklist (doctor name ✓, reg. no., date ≤ 6 months, patient matches, signature) → map lines (search) → Approve / Partial / Reject with reason → customer notified.

## 4. Key journeys
1. **Walk-in OTC bill** — scan ×3 → F8 → Cash → F10 → print. Target ≤ 20 s.
2. **H1 bill** — scan → banner → Ctrl+R → pick doctor (type-ahead) → patient name/address → pharmacist PIN → pay → register row auto-created.
3. **Online Rx order** — customer uploads Rx → store gets sound alert → pharmacist verifies → packer picks with FEFO suggestion → invoice → rider OTP delivery.
4. **GRN** — scan distributor invoice items or import CSV → batch/expiry/MRP/PTR/free → mismatch warnings → post.
5. **Expiry return** — Expiry dashboard → select batches → create return to distributor → debit note.

## 5. Visual language
- Tokens: primary teal `#0F766E`, surface neutrals, success green, warning amber, danger red.
- Schedule badges: OTC grey · G slate · H blue "Rx" · H1 purple "H1" · X red "X" · NDPS black "NDPS" · Cold-chain cyan snowflake.
- Typography: Inter / Noto Sans (Devanagari support for R2). Tabular numerals for amounts.
- Indian formats: `₹1,23,456.78`, `17-11-2026`.

## 6. Usability targets
| Metric | Target |
|---|---|
| OTC 3-item bill | ≤ 20 s, zero mouse use |
| New staff trained to bill | ≤ 30 min |
| Rx verification | ≤ 2 min median |
| Storefront checkout | ≤ 5 taps after cart |
| SUS score (pilot) | ≥ 75 |
