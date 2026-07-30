"use server";

import { Prisma, ProjectStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const optionalTextSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const projectSchema = z.object({
  name: z.string().trim().min(1),
  description: optionalTextSchema,
  status: z.nativeEnum(ProjectStatus).default(ProjectStatus.ACTIVE)
});

const projectUpdateSchema = projectSchema.partial();

type ProjectInput = z.input<typeof projectSchema>;
type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;

export type ProjectActionResult = {
  ok: boolean;
  error?: string;
};

function parseProjectInput(data: ProjectInput | FormData) {
  if (data instanceof FormData) {
    return projectSchema.safeParse({
      name: data.get("name"),
      description: data.get("description"),
      status: data.get("status") || ProjectStatus.ACTIVE
    });
  }

  return projectSchema.safeParse(data);
}

function parseProjectUpdateInput(data: ProjectUpdateInput | FormData) {
  if (data instanceof FormData) {
    return projectUpdateSchema.safeParse({
      name: data.get("name") || undefined,
      description: data.get("description") ?? undefined,
      status: data.get("status") || undefined
    });
  }

  return projectUpdateSchema.safeParse(data);
}

async function verifyProjectOwnership(
  db: Prisma.TransactionClient,
  id: string,
  userId: string
) {
  const project = await db.financialProject.findFirst({
    where: { id, userId }
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  return project;
}

async function logActivity(
  db: Prisma.TransactionClient,
  userId: string,
  action: "PROJECT_CREATED" | "PROJECT_UPDATED" | "PROJECT_DELETED",
  entityId: string,
  metadata?: Prisma.InputJsonObject
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      entityType: "FinancialProject",
      entityId,
      metadata
    }
  });
}

export async function createProject(
  data: ProjectInput | FormData
): Promise<ProjectActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseProjectInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid project." };
  }

  await prisma.$transaction(async (tx) => {
    const project = await tx.financialProject.create({
      data: {
        ...parsed.data,
        userId: user.id
      },
      select: { id: true, name: true, status: true }
    });

    await logActivity(tx, user.id, "PROJECT_CREATED", project.id, {
      name: project.name,
      status: project.status
    });
  });

  revalidatePath("/projects");
  return { ok: true };
}

export async function createProjectFormAction(formData: FormData) {
  await createProject(formData);
}

export async function updateProject(
  id: string,
  data: ProjectUpdateInput | FormData
): Promise<ProjectActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  const parsed = parseProjectUpdateInput(data);

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid project." };
  }

  await prisma.$transaction(async (tx) => {
    await verifyProjectOwnership(tx, id, user.id);
    await tx.financialProject.updateMany({
      where: { id, userId: user.id },
      data: parsed.data
    });
    const project = await verifyProjectOwnership(tx, id, user.id);

    await logActivity(tx, user.id, "PROJECT_UPDATED", project.id, {
      name: project.name,
      status: project.status
    });
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return { ok: true };
}

export async function updateProjectFormAction(id: string, formData: FormData) {
  await updateProject(id, formData);
}

export async function deleteProject(id: string): Promise<ProjectActionResult> {
  const user = await requireAuth();
  const rateLimit = await checkAuthenticatedMutation(user.id);
  if (!rateLimit.allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  await prisma.$transaction(async (tx) => {
    const project = await verifyProjectOwnership(tx, id, user.id);
    await tx.financialProject.deleteMany({
      where: { id, userId: user.id }
    });

    await logActivity(tx, user.id, "PROJECT_DELETED", id, {
      name: project.name,
      status: project.status
    });
  });

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProjectFormAction(id: string) {
  await deleteProject(id);
}

export async function listProjects() {
  const user = await requireAuth();

  return prisma.financialProject.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "asc" }, { name: "asc" }]
  });
}

export async function getProject(id: string) {
  const user = await requireAuth();
  return verifyProjectOwnership(prisma, id, user.id);
}
