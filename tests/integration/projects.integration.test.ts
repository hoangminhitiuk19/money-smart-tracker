import { randomUUID } from "node:crypto";
import { ProjectStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject
} from "@/lib/actions/projects";
import { prisma } from "@/lib/prisma";
import {
  cleanupAuditContext,
  createAuditContext,
  type AuditContext
} from "@/tests/integration/helpers/audit-context";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => ({
    id: authState.userId,
    email: "project-audit@audit.invalid",
    name: "Project audit user"
  }))
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkAuthenticatedMutation: vi.fn(async () => ({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  })),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly."
}));

let context: AuditContext;

beforeAll(async () => {
  context = await createAuditContext(`projects-${randomUUID()}`);
  authState.userId = context.userA.id;
}, 20_000);

afterAll(async () => {
  await cleanupAuditContext(context);
  await prisma.$disconnect();
});

async function installActivityFailure(userId: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `fail_project_activity_${suffix}`;
  const triggerName = `fail_project_activity_trigger_${suffix}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."userId" = '${userId}' AND NEW."action" LIKE 'PROJECT_%' THEN
        RAISE EXCEPTION 'forced project activity failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON "ActivityLog"
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "ActivityLog"`
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`
    );
  };
}

describe("project mutation atomicity", () => {
  it("rolls back project creation when its activity write fails", async () => {
    const projectName = `Atomic create ${randomUUID()}`;
    const uninstallFailure = await installActivityFailure(context.userA.id);

    try {
      await expect(
        createProject({
          name: projectName,
          status: ProjectStatus.ACTIVE
        })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    await expect(
      prisma.financialProject.count({
        where: { userId: context.userA.id, name: projectName }
      })
    ).resolves.toBe(0);
  });

  it("rolls back project updates when their activity write fails", async () => {
    const project = await prisma.financialProject.create({
      data: {
        userId: context.userA.id,
        name: `Atomic update ${randomUUID()}`,
        description: "Before",
        status: ProjectStatus.ACTIVE
      }
    });
    const uninstallFailure = await installActivityFailure(context.userA.id);

    try {
      await expect(
        updateProject(project.id, {
          description: "After",
          status: ProjectStatus.PAUSED
        })
      ).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    const persisted = await prisma.financialProject.findUniqueOrThrow({
      where: { id: project.id }
    });
    expect(persisted.description).toBe("Before");
    expect(persisted.status).toBe(ProjectStatus.ACTIVE);
    await expect(
      prisma.activityLog.count({
        where: { action: "PROJECT_UPDATED", entityId: project.id }
      })
    ).resolves.toBe(0);
  });

  it("rolls back project deletion when its activity write fails", async () => {
    const project = await prisma.financialProject.create({
      data: {
        userId: context.userA.id,
        name: `Atomic delete ${randomUUID()}`
      }
    });
    const uninstallFailure = await installActivityFailure(context.userA.id);

    try {
      await expect(deleteProject(project.id)).rejects.toThrow();
    } finally {
      await uninstallFailure();
    }

    await expect(
      prisma.financialProject.count({ where: { id: project.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.activityLog.count({
        where: { action: "PROJECT_DELETED", entityId: project.id }
      })
    ).resolves.toBe(0);
  });
});

describe("project CRUD ownership and activity", () => {
  it("commits create, update, and delete with matching activity entries", async () => {
    const name = `Project CRUD ${randomUUID()}`;

    await expect(createProject({ name })).resolves.toEqual({ ok: true });
    const project = await prisma.financialProject.findFirstOrThrow({
      where: { userId: context.userA.id, name }
    });
    expect(project).toMatchObject({
      description: null,
      status: ProjectStatus.ACTIVE,
      userId: context.userA.id
    });
    expect(project.createdAt).toBeInstanceOf(Date);
    expect(project.updatedAt).toBeInstanceOf(Date);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: context.userA.id,
          action: "PROJECT_CREATED",
          entityId: project.id
        }
      })
    ).resolves.toBe(1);

    await expect(
      updateProject(project.id, {
        description: "Updated atomically",
        status: ProjectStatus.COMPLETED
      })
    ).resolves.toEqual({ ok: true });
    await expect(
      prisma.activityLog.count({
        where: {
          userId: context.userA.id,
          action: "PROJECT_UPDATED",
          entityId: project.id
        }
      })
    ).resolves.toBe(1);

    await expect(deleteProject(project.id)).resolves.toEqual({ ok: true });
    await expect(
      prisma.financialProject.count({ where: { id: project.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.activityLog.count({
        where: {
          userId: context.userA.id,
          action: "PROJECT_DELETED",
          entityId: project.id
        }
      })
    ).resolves.toBe(1);
  });

  it("does not reveal or mutate another user's project", async () => {
    const foreignProject = await prisma.financialProject.create({
      data: {
        userId: context.userB.id,
        name: `Foreign project ${randomUUID()}`
      }
    });

    await expect(getProject(foreignProject.id)).rejects.toThrow(
      "Project not found."
    );
    await expect(
      updateProject(foreignProject.id, { status: ProjectStatus.PAUSED })
    ).rejects.toThrow("Project not found.");
    await expect(deleteProject(foreignProject.id)).rejects.toThrow(
      "Project not found."
    );

    const visibleProjects = await listProjects();
    expect(visibleProjects.some(({ id }) => id === foreignProject.id)).toBe(
      false
    );
    await expect(
      prisma.financialProject.findUniqueOrThrow({
        where: { id: foreignProject.id }
      })
    ).resolves.toMatchObject({
      status: ProjectStatus.ACTIVE,
      userId: context.userB.id
    });
    await expect(
      prisma.activityLog.count({ where: { entityId: foreignProject.id } })
    ).resolves.toBe(0);
  });
});
