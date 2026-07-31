"use server";

import { Prisma } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const dateFormats = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
const numberFormats = ["1,000,000", "1.000.000"] as const;
const dashboardPeriods = ["Week", "Month", "Year"] as const;

function bcryptPassword(fieldName: string) {
  return z.string().refine(
    (value) => new TextEncoder().encode(value).byteLength <= 72,
    `${fieldName} must be 72 bytes or fewer.`
  );
}

const settingsSchema = z
  .object({
    currentPassword: bcryptPassword("Current password").optional(),
    newPassword: bcryptPassword("New password").optional(),
    confirmPassword: bcryptPassword("Password confirmation").optional(),
    dateFormat: z.enum(dateFormats),
    defaultCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code."),
    defaultDashboardPeriod: z.enum(dashboardPeriods),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100, "Name must be 100 characters or fewer."),
    numberFormat: z.enum(numberFormats)
  })
  .superRefine((data, context) => {
    const wantsPasswordChange = Boolean(
      data.currentPassword || data.newPassword || data.confirmPassword
    );

    if (!wantsPasswordChange) {
      return;
    }

    if (!data.currentPassword) {
      context.addIssue({
        code: "custom",
        message: "Enter your current password.",
        path: ["currentPassword"]
      });
    }

    if (!data.newPassword || data.newPassword.length < 8) {
      context.addIssue({
        code: "custom",
        message: "New password must be at least 8 characters.",
        path: ["newPassword"]
      });
    }

    if (data.newPassword !== data.confirmPassword) {
      context.addIssue({
        code: "custom",
        message: "New password and confirmation must match.",
        path: ["confirmPassword"]
      });
    }
  });

export type SettingsState = {
  error?: string;
  success?: string;
};

export async function getUserSettings() {
  const user = await requireAuth();
  let settings;

  try {
    settings = await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {}
    });
  } catch (error) {
    if (
      !(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
    ) {
      throw error;
    }

    settings = await prisma.userSettings.findUnique({
      where: { userId: user.id }
    });

    if (!settings) {
      throw error;
    }
  }

  return { settings, user };
}

export async function updateUserSettings(
  _previousState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  const parsed = settingsSchema.safeParse({
    confirmPassword: formData.get("confirmPassword")?.toString(),
    currentPassword: formData.get("currentPassword")?.toString(),
    dateFormat: formData.get("dateFormat"),
    defaultCurrency: formData.get("defaultCurrency"),
    defaultDashboardPeriod: formData.get("defaultDashboardPeriod"),
    name: formData.get("name"),
    newPassword: formData.get("newPassword")?.toString(),
    numberFormat: formData.get("numberFormat")
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your settings." };
  }

  const wantsPasswordChange = Boolean(
    parsed.data.currentPassword ||
      parsed.data.newPassword ||
      parsed.data.confirmPassword
  );
  let passwordHash: string | undefined;

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true }
    });

    if (!currentUser) {
      return { error: "User account not found." };
    }

    if (wantsPasswordChange) {
      const passwordMatches = await compare(
        parsed.data.currentPassword ?? "",
        currentUser.passwordHash
      );

      if (!passwordMatches) {
        return { error: "Current password is incorrect." };
      }

      passwordHash = await hash(parsed.data.newPassword ?? "", 12);
    }
  } catch {
    return { error: "Unable to save settings." };
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: parsed.data.name,
          ...(passwordHash ? { passwordHash } : {})
        }
      }),
      prisma.userSettings.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          defaultCurrency: parsed.data.defaultCurrency.toUpperCase(),
          dateFormat: parsed.data.dateFormat,
          numberFormat: parsed.data.numberFormat,
          defaultDashboardPeriod: parsed.data.defaultDashboardPeriod
        },
        update: {
          defaultCurrency: parsed.data.defaultCurrency.toUpperCase(),
          dateFormat: parsed.data.dateFormat,
          numberFormat: parsed.data.numberFormat,
          defaultDashboardPeriod: parsed.data.defaultDashboardPeriod
        }
      })
    ]);
  } catch {
    return { error: "Unable to save settings." };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/accounts");
  revalidatePath("/goals");
  revalidatePath("/projects");
  revalidatePath("/renewals");
  revalidatePath("/reports");
  revalidatePath("/transactions");
  return { success: "Settings saved." };
}
