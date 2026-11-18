import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export default function Page() {
  return <ModulePlaceholder title="Accounts" items={[["UC-ACC-02","Auto journals for every document","MVP"],["UC-ACC-03","Payment / receipt / contra / journal vouchers","MVP"],["UC-ACC-04","Day book, ledgers, trial balance (v_trial_balance)","MVP"],["UC-ACC-06","P&L, balance sheet, margin","MVP"],["UC-ACC-07","Period lock","MVP"],["UC-ACC-09","Tally XML export","MVP"]]} />;
}
