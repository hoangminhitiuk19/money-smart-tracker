import { CategoryType, Prisma, QualityRating } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DefaultCategory = {
  name: string;
  type: CategoryType;
  defaultQualityRating?: QualityRating;
  defaultCountTowardFeeWaiver?: boolean;
};

const defaultCategories = [
  { name: "Salary", type: CategoryType.INCOME },
  {
    name: "Food",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.B
  },
  {
    name: "Drink",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.B
  },
  {
    name: "Education",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.A
  },
  {
    name: "Health",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.A
  },
  {
    name: "Transport",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.B
  },
  {
    name: "Housing",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.B
  },
  {
    name: "Shopping",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.C
  },
  {
    name: "Entertainment",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.B
  },
  {
    name: "Subscription",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.C
  },
  {
    name: "Investment",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.A
  },
  { name: "Side Business", type: CategoryType.BOTH },
  { name: "Credit Card Payment", type: CategoryType.TRANSFER },
  {
    name: "Annual Fee",
    type: CategoryType.EXPENSE,
    defaultQualityRating: QualityRating.C,
    defaultCountTowardFeeWaiver: false
  },
  { name: "Refund", type: CategoryType.OTHER },
  {
    name: "Other",
    type: CategoryType.BOTH,
    defaultQualityRating: QualityRating.B
  }
] satisfies DefaultCategory[];

export async function seedDefaultCategories(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  await db.category.createMany({
    data: defaultCategories.map((category) => ({
      ...category,
      userId,
      isDefault: true
    }))
  });
}
