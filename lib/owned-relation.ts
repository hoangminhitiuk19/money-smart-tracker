export function ownedRelation<T extends { userId: string }>(
  relation: T | null,
  userId: string
) {
  return relation?.userId === userId ? relation : null;
}
