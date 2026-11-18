/** Online order lifecycle (UC-OMS-06). Mirrors the DB trigger `enforce_order_transition`. */
export type OrderStatus =
  | "placed" | "rx_verification" | "confirmed" | "picking" | "packed"
  | "out_for_delivery" | "ready_for_pickup" | "delivered" | "cancelled" | "rejected" | "returned";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["rx_verification", "confirmed", "cancelled"],
  rx_verification: ["confirmed", "rejected", "cancelled"],
  confirmed: ["picking", "cancelled"],
  picking: ["packed", "cancelled"],
  packed: ["out_for_delivery", "ready_for_pickup"],
  out_for_delivery: ["delivered", "returned"],
  ready_for_pickup: ["delivered", "cancelled"],
  delivered: ["returned"],
  cancelled: [],
  rejected: [],
  returned: [],
};

export interface OrderGuardCtx { hasRxItems: boolean; rxApproved: boolean; invoiceId?: string | null; deliveryOtpVerified?: boolean }

export function canTransition(from: OrderStatus, to: OrderStatus, ctx: OrderGuardCtx): { ok: true } | { ok: false; reason: string } {
  if (!TRANSITIONS[from].includes(to)) return { ok: false, reason: `Cannot move order from ${from} to ${to}` };
  if (from === "placed" && to === "confirmed" && ctx.hasRxItems)
    return { ok: false, reason: "Order has prescription items and must go to pharmacist verification" };
  if (to === "confirmed" && ctx.hasRxItems && !ctx.rxApproved)
    return { ok: false, reason: "Pharmacist approval of prescription is required" };
  if ((to === "out_for_delivery" || to === "ready_for_pickup") && !ctx.invoiceId)
    return { ok: false, reason: "Invoice must be generated before dispatch" };
  if (to === "delivered" && from === "out_for_delivery" && !ctx.deliveryOtpVerified)
    return { ok: false, reason: "Delivery OTP must be verified" };
  return { ok: true };
}

export const nextStatuses = (s: OrderStatus) => TRANSITIONS[s];
