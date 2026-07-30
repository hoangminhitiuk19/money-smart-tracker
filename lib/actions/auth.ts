"use server";

import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { seedDefaultCategories } from "@/lib/category-seed";
import { prisma } from "@/lib/prisma";
import {
  checkRegistrationAttempt,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  name: z.string().min(1)
});

const DUPLICATE_ACCOUNT_MESSAGE = "An account with this email already exists.";

export type RegisterState = {
  error?: string;
};

export async function registerUser(
  _previousState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name")
  });

  if (!parsed.success) {
    return { error: "Enter a valid name, email, and password." };
  }

  try {
    const decision = await checkRegistrationAttempt(
      await headers(),
      parsed.data.email
    );

    if (!decision.allowed || decision.unavailable) {
      return { error: RATE_LIMIT_MESSAGE };
    }
  } catch {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true }
  });

  if (existingUser) {
    return { error: DUPLICATE_ACCOUNT_MESSAGE };
  }

  const passwordHash = await hash(parsed.data.password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          passwordHash
        },
        select: { id: true }
      });

      await seedDefaultCategories(user.id, tx);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: DUPLICATE_ACCOUNT_MESSAGE };
    }

    throw error;
  }

  redirect("/login?registered=1");
}
