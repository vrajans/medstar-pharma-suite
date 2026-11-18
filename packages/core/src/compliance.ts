/**
 * Drug schedule rules (Drugs & Cosmetics Rules 1945, NDPS Act 1985).
 * Validated by pharmacy-sme — see docs/03-sme-validation.md. State variations are configured via StorePolicy.
 */
export type DrugSchedule = "OTC" | "G" | "H" | "H1" | "X" | "C" | "C1" | "NDPS";

export interface ComplianceProduct {
  id: string;
  name: string;
  schedule: DrugSchedule;
  rxRequired?: boolean;
  habitForming?: boolean;
  coldChain?: boolean;
}

export const SCHEDULE_INFO: Record<DrugSchedule, { label: string; rx: boolean; register: boolean; online: boolean; retentionYears: number }> = {
  OTC: { label: "OTC", rx: false, register: false, online: true, retentionYears: 0 },
  G: { label: "Schedule G", rx: false, register: false, online: true, retentionYears: 0 },
  C: { label: "Schedule C", rx: false, register: false, online: true, retentionYears: 0 },
  C1: { label: "Schedule C1", rx: false, register: false, online: true, retentionYears: 0 },
  H: { label: "Schedule H", rx: true, register: false, online: true, retentionYears: 0 },
  H1: { label: "Schedule H1", rx: true, register: true, online: true, retentionYears: 3 },
  X: { label: "Schedule X", rx: true, register: true, online: false, retentionYears: 2 },
  NDPS: { label: "NDPS", rx: true, register: true, online: false, retentionYears: 2 },
};

export const requiresRx = (p: ComplianceProduct) => !!p.rxRequired || SCHEDULE_INFO[p.schedule].rx;
export const requiresRegister = (p: ComplianceProduct) => SCHEDULE_INFO[p.schedule].register;
export const onlineDeliveryAllowed = (p: ComplianceProduct) => SCHEDULE_INFO[p.schedule].online && !p.habitForming;

export interface PrescriptionInfo {
  prescriberName?: string;
  prescriberRegNo?: string;
  prescriberAddress?: string;
  rxDate?: string;
  rxImagePath?: string;
  patientName?: string;
  patientAddress?: string;
}

export interface StorePolicy {
  /** hard = Rx items cannot be billed unless a pharmacist is on duty; soft = warn + log */
  pharmacistPresence: "hard" | "soft";
  rxValidityDays: number;
}

export interface ComplianceIssue { code: string; severity: "block" | "warn"; productId?: string; message: string }

export function validateCounterSale(
  items: ComplianceProduct[],
  ctx: { rx?: PrescriptionInfo; pharmacistOnDuty: boolean; pharmacistApproved: boolean; today: string; policy: StorePolicy },
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const rxItems = items.filter(requiresRx);
  const regItems = items.filter(requiresRegister);

  if (rxItems.length) {
    if (!ctx.pharmacistOnDuty)
      issues.push({ code: "NO_PHARMACIST", severity: ctx.policy.pharmacistPresence === "hard" ? "block" : "warn", message: "Prescription drugs require a registered pharmacist on duty" });
    if (!ctx.pharmacistApproved)
      issues.push({ code: "PHARMACIST_APPROVAL", severity: "block", message: "Pharmacist approval required for prescription drugs" });
  }

  if (regItems.length) {
    const rx = ctx.rx ?? {};
    const need: Array<[keyof PrescriptionInfo, string]> = [
      ["patientName", "patient name"], ["patientAddress", "patient address"],
      ["prescriberName", "prescriber name"], ["prescriberRegNo", "prescriber registration number"], ["rxDate", "prescription date"],
    ];
    for (const p of regItems) {
      for (const [k, label] of need) {
        if (!rx[k]?.toString().trim())
          issues.push({ code: `MISSING_${k.toUpperCase()}`, severity: "block", productId: p.id, message: `${SCHEDULE_INFO[p.schedule].label}: ${label} required` });
      }
      if ((p.schedule === "X" || p.schedule === "NDPS") && !rx.rxImagePath)
        issues.push({ code: "RX_COPY", severity: "block", productId: p.id, message: `${SCHEDULE_INFO[p.schedule].label}: prescription copy must be retained` });
    }
  }

  if (rxItems.length && ctx.rx?.rxDate) {
    const age = (Date.parse(ctx.today) - Date.parse(ctx.rx.rxDate)) / 86_400_000;
    if (age > ctx.policy.rxValidityDays)
      issues.push({ code: "RX_EXPIRED", severity: "warn", message: `Prescription is ${Math.floor(age)} days old` });
    if (age < 0) issues.push({ code: "RX_FUTURE", severity: "block", message: "Prescription date is in the future" });
  }
  return dedupe(issues);
}

export function validateOnlineCart(
  items: ComplianceProduct[],
  ctx: { fulfilment: "delivery" | "pickup"; rxUploaded: boolean },
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const p of items) {
    if (ctx.fulfilment === "delivery" && !onlineDeliveryAllowed(p))
      issues.push({ code: "NOT_FOR_DELIVERY", severity: "block", productId: p.id, message: `${p.name} cannot be delivered; please buy at the store with the original prescription` });
  }
  if (items.some(requiresRx) && !ctx.rxUploaded)
    issues.push({ code: "RX_REQUIRED", severity: "block", message: "Upload a valid prescription for prescription medicines" });
  return issues;
}

function dedupe(list: ComplianceIssue[]): ComplianceIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const hasBlockingIssue = (issues: ComplianceIssue[]) => issues.some((i) => i.severity === "block");
