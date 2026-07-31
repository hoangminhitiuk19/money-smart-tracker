import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function ReceiptUploadLoading() {
  return (
    <ProtectedPageLoading
      cards={1}
      formTitle="Receipt preview and expense details"
      maxWidth="max-w-5xl"
      title="Receipt Upload"
    />
  );
}
