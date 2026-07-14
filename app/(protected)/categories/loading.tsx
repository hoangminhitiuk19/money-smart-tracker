import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function CategoriesLoading() {
  return (
    <ProtectedPageLoading
      formTitle="Add Category"
      maxWidth="max-w-6xl"
      title="Categories"
    />
  );
}
