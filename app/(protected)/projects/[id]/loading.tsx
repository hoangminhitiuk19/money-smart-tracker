import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function ProjectDetailLoading() {
  return (
    <ProtectedPageLoading
      cards={1}
      maxWidth="max-w-4xl"
      title="Project Details"
    />
  );
}
