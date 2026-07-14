import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function RenewalsLoading() {
  return (
    <ProtectedPageLoading
      cards={4}
      formTitle="Add Renewal"
      title="Renewals"
    />
  );
}
