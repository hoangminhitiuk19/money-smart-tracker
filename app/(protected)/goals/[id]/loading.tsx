import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function GoalDetailLoading() {
  return (
    <ProtectedPageLoading
      cards={2}
      formTitle="Goal Details"
      maxWidth="max-w-5xl"
      title="Saving Goal"
    />
  );
}
