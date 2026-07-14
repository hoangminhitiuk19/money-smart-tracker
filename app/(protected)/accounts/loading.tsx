import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function AccountsLoading() {
  return (
    <ProtectedPageLoading
      formTitle="Add Account"
      maxWidth="max-w-6xl"
      title="Accounts & Wallets"
    />
  );
}
