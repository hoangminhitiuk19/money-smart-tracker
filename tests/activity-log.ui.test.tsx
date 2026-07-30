import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityLogPage from "@/app/(protected)/activity-log/page";

const activityPageMocks = vi.hoisted(() => ({
  after: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
  requireAuth: vi.fn()
}));

vi.mock("next/server", () => ({
  after: activityPageMocks.after
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: activityPageMocks.requireAuth
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: {
      count: activityPageMocks.count,
      deleteMany: activityPageMocks.deleteMany,
      findMany: activityPageMocks.findMany
    }
  }
}));

type ActivityContentElement = ReactElement<{
  searchParams: Record<string, string | string[] | undefined>;
}> & {
  type: (props: {
    searchParams: Record<string, string | string[] | undefined>;
  }) => Promise<ReactElement>;
};

async function renderActivityPage(
  searchParams: Record<string, string | string[] | undefined>
) {
  const shell = (await ActivityLogPage({
    searchParams: Promise.resolve(searchParams)
  })) as ReactElement<{ children: ActivityContentElement }>;
  const contentElement = shell.props.children;
  const content = await contentElement.type(contentElement.props);
  return renderToStaticMarkup(content);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
  vi.clearAllMocks();
  activityPageMocks.requireAuth.mockResolvedValue({
    id: "activity-user"
  });
  activityPageMocks.findMany.mockResolvedValue([
    {
      id: "activity-51",
      action: "TRANSACTION_CREATED",
      entityType: "Transaction",
      entityId: "adjustment-1",
      metadata: {
        amount: "15.00",
        type: "ADJUSTMENT",
        title: "Ledger correction",
        fromSourceId: null,
        toSourceId: null
      },
      createdAt: new Date("2026-07-31T11:00:00.000Z")
    }
  ]);
  activityPageMocks.count.mockResolvedValue(51);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityLogPage retained pagination", () => {
  it("queries the owned 90-day window in 50-row pages and renders navigation", async () => {
    const markup = await renderActivityPage({
      action: "TRANSACTION_CREATED",
      page: "2"
    });
    const expectedWhere = {
      userId: "activity-user",
      action: "TRANSACTION_CREATED",
      createdAt: {
        gte: new Date("2026-05-02T12:00:00.000Z")
      }
    };

    expect(activityPageMocks.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: "desc" },
      skip: 50,
      take: 50
    });
    expect(activityPageMocks.count).toHaveBeenCalledWith({
      where: expectedWhere
    });
    expect(activityPageMocks.after).toHaveBeenCalledTimes(1);
    expect(markup).toContain("Showing 51-51 of 51 log entries");
    expect(markup).toContain("Page 2 of 2");
    expect(markup).toContain(
      'href="/activity-log?action=TRANSACTION_CREATED&amp;page=1"'
    );
    expect(markup).toContain(">Previous</a>");
    expect(markup).toContain(">Next</a>");
    expect(markup).toContain(
      "Created ADJUSTMENT transaction: Ledger correction (15.00 VND)"
    );
  });
});
