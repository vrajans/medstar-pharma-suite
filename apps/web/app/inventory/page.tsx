import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function Page() {
  return <ModulePlaceholder title="Inventory" items={[["UC-INV-01","Batch-wise stock per store","MVP"],["UC-INV-03","Expiry dashboard 30/60/90 days","MVP"],["UC-INV-04","Stock adjustment with approval","MVP"],["UC-INV-07","Batch recall & quarantine (apply_recall)","MVP"],["UC-INV-05","Cycle count by rack","R2"],["UC-INV-06","Inter-store transfer + e-way bill","R2"]]} />;
}
