import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function ReportsLoading() {
  return (
    <ProtectedPageLoading
      cards={6}
      formTitle="Date Range"
      title="Reports"
    />
  );
}
