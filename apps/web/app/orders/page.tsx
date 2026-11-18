"use client";
import { useEffect, useState } from "react";
import { canTransition, nextStatuses, type OrderStatus } from "@medstar/core";
import { supabaseBrowser } from "@/lib/supabase";

interface Order { id: string; orderNo: string; customer: string; status: OrderStatus; hasRx: boolean; rxApproved: boolean; invoiceId?: string; fulfilment: "delivery" | "pickup"; otp?: boolean }

const COLUMNS: OrderStatus[] = ["placed", "rx_verification", "confirmed", "picking", "packed", "out_for_delivery", "delivered"];
const LABEL: Partial<Record<OrderStatus, string>> = {
  placed: "New", rx_verification: "Rx check", confirmed: "Confirmed", picking: "Picking", packed: "Packed", out_for_delivery: "Out for delivery", delivered: "Delivered",
};

export default function OrdersBoard() {
  const [orders, setOrders] = useState<Order[]>([
    { id: "1", orderNo: "WEB-261117-A1B2C3", customer: "Meena R", status: "rx_verification", hasRx: true, rxApproved: false, fulfilment: "delivery" },
    { id: "2", orderNo: "WEB-261117-Z9Y8X7", customer: "Kiran S", status: "placed", hasRx: false, rxApproved: false, fulfilment: "pickup" },
    { id: "3", orderNo: "WEB-261117-Q1W2E3", customer: "Farah N", status: "packed", hasRx: false, rxApproved: false, fulfilment: "delivery", invoiceId: "inv-1" },
  ]);
  const [msg, setMsg] = useState("");

  // UC-OMS-11: realtime alert for new orders
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    const ch = sb.channel("orders").on("postgres_changes", { event: "INSERT", schema: "public", table: "online_orders" }, () => {
      void new Audio("/new-order.mp3").play().catch(() => {});
    }).subscribe();
    return () => { void sb.removeChannel(ch); };
  }, []);

  const move = (o: Order, to: OrderStatus) => {
    const r = canTransition(o.status, to, { hasRxItems: o.hasRx, rxApproved: o.rxApproved, invoiceId: o.invoiceId, deliveryOtpVerified: o.otp });
    if (!r.ok) { setMsg(r.reason); return; }
    setMsg("");
    setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, status: to, invoiceId: to === "packed" ? x.invoiceId ?? "inv-new" : x.invoiceId } : x)));
  };

  return (
    <div className="p-4">
      <h1 className="mb-2 text-xl font-semibold">Online orders</h1>
      {msg && <p role="alert" className="mb-2 rounded bg-danger/10 p-2 text-sm text-danger">{msg}</p>}
      <div className="grid grid-cols-7 gap-3">
        {COLUMNS.map((c) => (
          <div key={c} className="min-h-[60vh] rounded-md bg-surface p-2">
            <h2 className="mb-2 text-xs font-semibold uppercase text-muted">{LABEL[c]}</h2>
            {orders.filter((o) => o.status === c).map((o) => (
              <div key={o.id} className="mb-2 rounded border border-line p-2 text-sm">
                <div className="font-medium">{o.orderNo}</div>
                <div className="text-muted">{o.customer} · {o.fulfilment}</div>
                {o.hasRx && <div className="text-xs text-sch-h1">Rx order {o.rxApproved ? "✓ verified" : "· awaiting pharmacist"}</div>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {nextStatuses(o.status).map((n) => (
                    <button key={n} onClick={() => move(o, n)} className="rounded border border-line px-1.5 text-xs hover:bg-brand-50">→ {LABEL[n] ?? n}</button>))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
