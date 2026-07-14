import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function ActivityLogLoading() {
  return (
    <ProtectedPageLoading
      cards={2}
      formTitle="Filter Activity"
      title="Activity Log"
    />
  );
}
