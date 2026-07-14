import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function GoalsLoading() {
  return (
    <ProtectedPageLoading
      formTitle="Add Goal"
      maxWidth="max-w-6xl"
      title="Saving Goals"
    />
  );
}
