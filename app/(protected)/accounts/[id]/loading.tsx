import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function AccountDetailLoading() {
  return (
    <ProtectedPageLoading
      cards={4}
      maxWidth="max-w-5xl"
      title="Account Details"
    />
  );
}
