# Counter Setup Guide — PC, Printer, Scanner, Offline

Owner: `customer-success` · Reviewed: `frontend-engineer`, `security-privacy`

## 1. Recommended hardware
| Item | Minimum | Notes |
|---|---|---|
| PC | Windows 10/11, 4 GB RAM, Chrome (latest) | One Windows login per staff member, auto-lock after 5 min, BitLocker on |
| Receipt printer | 80 mm thermal (USB or LAN), Windows driver installed | 58 mm also works; set as **default printer** |
| Barcode scanner | USB, keyboard (HID) mode, **Enter suffix** on | Scan into the POS search box — no driver needed |
| Cash drawer | RJ11 to the receipt printer | Enable "open drawer on print" in the printer driver if wanted |
| Internet | Any; the POS keeps billing offline | Bills sync automatically when the connection returns |

## 2. Install the POS shortcut (silent printing)
1. Install the printer driver and make the thermal printer the **default printer** (Windows Settings → Bluetooth & devices → Printers & scanners, turn off "Let Windows manage my default printer").
2. In the project folder (or a copy of `scripts\windows`), run once:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\create-pos-shortcut.ps1 -Url http://localhost:3000/pos -Setup
   ```
   A POS window opens without silent printing. Sign in, bill any item, and in the print dialog choose the thermal printer, paper **80 mm** (or 58 mm), **Margins: None**, untick *Headers and footers*. Print, then close the window.
3. Create the desktop shortcut:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\create-pos-shortcut.ps1 -Url http://localhost:3000/pos
   ```
   From now on use **MedStar POS** on the desktop: bills, credit notes and X/Z reports print immediately with no dialog.
4. Production: replace the URL with the live address (e.g. `https://app.medstar.in/pos`).

The shortcut uses its own Chrome profile (`%LOCALAPPDATA%\MedStarPOS\Chrome`), so silent printing works even when normal Chrome is open, and the counter's sign-in is kept separate from personal browsing.

## 3. Working offline
- The billing screen is cached by the browser after the first visit **in a production build** (`pnpm --filter @medstar/web build && pnpm --filter @medstar/web start`, or the hosted app). In `dev` mode the offline cache is deliberately off.
- Open the POS once while online each morning (it refreshes the product catalogue and the cached screen).
- If the internet drops, keep billing: bills get provisional numbers `OFF-<counter>-<n>`, print normally and sync later with final invoice numbers. Prescription drugs billed offline are flagged for review because the pharmacist PIN can't be checked by the server.
- If Chrome is closed and reopened with no internet, the POS still opens from the cache.
- **Sign out** removes the cached billing screen from that PC.

## 4. Daily routine
| When | Who | Steps |
|---|---|---|
| Opening | Cashier | Open the POS → **Open shift** → enter the cash in the drawer. Pharmacist → **Start duty** with PIN. |
| During the day | Cashier | Petty expenses and cash added/removed → **Cash in/out** (never take cash out without recording it). |
| Any time | Owner | **X report** shows the running shift without closing it. |
| Closing | Cashier | **Close shift** → count notes by denomination *before* seeing the system total (blind count) → Z report prints. A difference over ₹100 needs a note. |
| Closing | Owner | Check the Z report, the "rejected bills" panel on the POS, and Sales → bills marked *review*. |

## 5. Troubleshooting
| Symptom | Fix |
|---|---|
| Print dialog still appears | Close **all** MedStar POS windows and start again from the shortcut (the flag applies only when the profile starts). |
| Receipt has wide margins / tiny text | Run the `-Setup` step again and pick the 80 mm paper size with Margins: None. |
| Scanner types but nothing is added | Enable the scanner's Enter (CR) suffix; click into the search box (F2). |
| "No open shift" banner | Open a shift; billing still works, but sales then don't appear in a cashier's Z report. |
| Bills stuck "waiting to sync" | Check internet; they retry every minute. Rejected ones show in the red panel with the reason and a Retry button. |
