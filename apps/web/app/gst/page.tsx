import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function Page() {
  return <ModulePlaceholder title="GST" items={[["UC-GST-01","Effective-dated HSN rate table","MVP"],["UC-GST-02","GSTR-1 (B2B, B2CS, CDNR, HSN, docs)","MVP"],["UC-GST-03","GSTR-3B summary","MVP"],["UC-GST-04","Composition: CMP-08, GSTR-4","MVP"],["UC-GST-05","B2B e-invoice (IRN)","R2"],["UC-GST-06","E-way bill","R2"]]} />;
}
