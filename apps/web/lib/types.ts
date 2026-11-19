export type Role = "owner" | "admin" | "pharmacist" | "billing" | "purchase" | "accountant" | "rider" | "auditor";

export interface OnDutyPharmacist { id: string; name: string; regNo: string }

export interface StoreCtx {
  id: string;
  code: string;
  name: string;
  gstScheme: "regular" | "composition";
  stateCode: string;
  gstin?: string | null;
  address?: string | null;
  phone?: string | null;
  pharmacistPresence: "hard" | "soft";
  rxValidityDays: number;
  nearExpiryDays: number;
  onDuty: OnDutyPharmacist[];
}

export interface OrgCtx { orgId: string; orgName: string; role: Role; maxDiscountPct: number; stores: StoreCtx[] }

export interface AppCtx {
  mode: "demo" | "live";
  userId: string | null;
  email: string | null;
  orgs: OrgCtx[];
  /** currently selected org/store (from the ms_store cookie, else the first available) */
  org: OrgCtx | null;
  store: StoreCtx | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner", admin: "Admin", pharmacist: "Pharmacist", billing: "Billing staff", purchase: "Purchase / inventory",
  accountant: "Accountant", rider: "Delivery rider", auditor: "Auditor (read-only)",
};

/** Which roles see which back-office areas (UI only — the database enforces the real rules). */
export const AREA_ROLES: Record<string, Role[]> = {
  "/pos": ["owner", "admin", "pharmacist", "billing"],
  "/orders": ["owner", "admin", "pharmacist", "billing", "rider"],
  "/rx-verify": ["owner", "admin", "pharmacist"],
  "/products": ["owner", "admin", "pharmacist", "purchase", "auditor"],
  "/customers": ["owner", "admin", "pharmacist", "billing", "accountant", "auditor"],
  "/doctors": ["owner", "admin", "pharmacist", "billing", "accountant", "auditor"],
  "/inventory": ["owner", "admin", "pharmacist", "purchase", "auditor"],
  "/purchase": ["owner", "admin", "purchase"],
  "/accounts": ["owner", "admin", "accountant", "auditor"],
  "/gst": ["owner", "admin", "accountant", "auditor"],
  "/compliance": ["owner", "admin", "pharmacist", "auditor"],
  "/settings": ["owner", "admin"],
};
