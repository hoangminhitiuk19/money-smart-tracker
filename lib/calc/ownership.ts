export type OwnedRecord = {
  userId: string;
};

export function ownershipGuard(record: OwnedRecord | null, userId: string) {
  if (!record || record.userId !== userId) {
    throw new Error("Record not found or access denied.");
  }

  return record;
}
