import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function ProjectsLoading() {
  return (
    <ProtectedPageLoading
      formTitle="Add Project"
      maxWidth="max-w-6xl"
      title="Projects"
    />
  );
}
