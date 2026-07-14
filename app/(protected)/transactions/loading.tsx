import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function TransactionsLoading() {
  return (
    <ProtectedPageLoading
      cards={2}
      formTitle="Filters"
      title="Transactions"
    />
  );
}
