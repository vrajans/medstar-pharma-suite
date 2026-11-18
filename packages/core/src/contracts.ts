import { z } from "zod";

/** Payload for rpc('post_sale') — shared by POS (online + offline outbox) and server. */
export const SaleLineSchema = z.object({
  productId: z.string().uuid(),
  qtyBase: z.number().int().positive(),
  batchId: z.string().uuid().optional(),
  packPricePaise: z.number().int().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).default(0),
});

export const PaymentSchema = z.object({
  mode: z.enum(["cash", "upi", "card", "credit", "wallet"]),
  amountPaise: z.number().int(),
  reference: z.string().max(64).optional(),
});

export const PrescriptionSchema = z.object({
  doctorId: z.string().uuid().optional(),
  prescriberName: z.string().max(120).optional(),
  prescriberRegNo: z.string().max(40).optional(),
  prescriberAddress: z.string().max(300).optional(),
  rxDate: z.string().date().optional(),
  rxImagePath: z.string().max(300).optional(),
  patientName: z.string().max(120).optional(),
  patientAddress: z.string().max(300).optional(),
});

export const PostSaleSchema = z.object({
  billUuid: z.string().uuid(),
  storeId: z.string().uuid(),
  deviceCode: z.string().max(12),
  provisionalNo: z.string().max(32).optional(),
  billedAt: z.string().datetime(),
  customerId: z.string().uuid().optional(),
  billDiscountPct: z.number().min(0).max(100).default(0),
  lines: z.array(SaleLineSchema).min(1).max(200),
  payments: z.array(PaymentSchema).min(1),
  prescription: PrescriptionSchema.optional(),
  pharmacistId: z.string().uuid().optional(),
  onlineOrderId: z.string().uuid().optional(),
  offline: z.boolean().default(false),
});
export type PostSale = z.infer<typeof PostSaleSchema>;

export const PlaceOnlineOrderSchema = z.object({
  storeId: z.string().uuid(),
  fulfilment: z.enum(["delivery", "pickup"]),
  addressId: z.string().uuid().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), qtyBase: z.number().int().positive() })).max(100),
  prescriptionIds: z.array(z.string().uuid()).max(5).default([]),
  paymentMode: z.enum(["prepaid", "cod", "pay_at_store"]),
  notes: z.string().max(500).optional(),
});
export type PlaceOnlineOrder = z.infer<typeof PlaceOnlineOrderSchema>;
