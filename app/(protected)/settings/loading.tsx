import { ProtectedPageLoading } from "@/components/ui/ProtectedPageLoading";

export default function SettingsLoading() {
  return (
    <ProtectedPageLoading
      cards={2}
      formTitle="Preferences and profile"
      maxWidth="max-w-5xl"
      title="Settings"
    />
  );
}
