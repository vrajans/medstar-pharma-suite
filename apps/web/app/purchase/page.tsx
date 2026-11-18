import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function Page() {
  return <ModulePlaceholder title="Purchase" items={[["UC-PUR-02","Auto purchase suggestion","MVP"],["UC-PUR-03","Purchase order via WhatsApp/PDF","MVP"],["UC-PUR-04","GRN with batch, expiry, PTR, free qty (post_purchase)","MVP"],["UC-PUR-06","MRP / PTR / short-expiry validations","MVP"],["UC-PUR-07","Expiry & breakage returns → debit note","MVP"],["UC-PUR-10","ITC reconciliation with GSTR-2B","R2"]]} />;
}
