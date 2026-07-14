import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function DashboardLoading() {
  return (
    <ProtectedPageLoading
      cards={6}
      formTitle="Date Range"
      title="Dashboard"
    />
  );
}
