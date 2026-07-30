import { ProjectStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@/lib/actions/projects";
import { prisma } from "@/lib/prisma";
import {
  checkAuthenticatedMutation,
  RATE_LIMIT_MESSAGE
} from "@/lib/security/rate-limit";

const mockUser = { id: "user-1", email: "user@test.com", name: "Test User" };
const projectMocks = vi.hoisted(() => ({
  activityCreate: vi.fn(async () => ({})),
  projectCreate: vi.fn(async ({ data }: any) => ({
    id: "new-project",
    name: data.name,
    status: data.status
  })),
  rootActivityCreate: vi.fn(),
  rootProjectCreate: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => mockUser)
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

vi.mock("@/lib/prisma", () => {
  const transactionClient = {
    financialProject: {
      create: projectMocks.projectCreate
    },
    activityLog: {
      create: projectMocks.activityCreate
    }
  };

  projectMocks.transaction.mockImplementation(async (callback) =>
    callback(transactionClient)
  );

  return {
    prisma: {
      $transaction: projectMocks.transaction,
      financialProject: {
        create: projectMocks.rootProjectCreate
      },
      activityLog: {
        create: projectMocks.rootActivityCreate
      }
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuthenticatedMutation).mockResolvedValue({
    allowed: true,
    unavailable: false,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 60
  });
});

describe("project mutation rate limiting", () => {
  it("denies a rate-limited create before creating a project", async () => {
    vi.mocked(checkAuthenticatedMutation).mockResolvedValueOnce({
      allowed: false,
      unavailable: false,
      limit: 60,
      remaining: 0,
      retryAfterSeconds: 60
    });

    const result = await createProject({
      name: "Kitchen remodel",
      status: ProjectStatus.ACTIVE
    });

    expect(result).toEqual({ ok: false, error: RATE_LIMIT_MESSAGE });
    expect(prisma.financialProject.create).not.toHaveBeenCalled();
  });
});

describe("project mutation transaction boundary", () => {
  it("runs project creation and activity logging through one transaction client", async () => {
    await expect(
      createProject({
        name: "Kitchen remodel",
        status: ProjectStatus.ACTIVE
      })
    ).resolves.toEqual({ ok: true });

    expect(projectMocks.transaction).toHaveBeenCalledTimes(1);
    expect(projectMocks.projectCreate).toHaveBeenCalledTimes(1);
    expect(projectMocks.activityCreate).toHaveBeenCalledTimes(1);
    expect(projectMocks.rootProjectCreate).not.toHaveBeenCalled();
    expect(projectMocks.rootActivityCreate).not.toHaveBeenCalled();
  });
});
