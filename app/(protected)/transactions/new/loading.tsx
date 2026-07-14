import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function NewTransactionLoading() {
  return (
    <ProtectedPageLoading
      cards={2}
      formTitle="Transaction Form"
      maxWidth="max-w-5xl"
      title="New Transaction"
    />
  );
}
