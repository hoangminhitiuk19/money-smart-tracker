import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboundEmailPage from "@/app/(protected)/transactions/capture/email/page";

const pageMocks = vi.hoisted(() => ({
  getInboundEmailSetup: vi.fn(),
  requireAuth: vi.fn(),
  panel: vi.fn()
}));

vi.mock("@/lib/actions/inbound-email", () => ({
  getInboundEmailSetup: pageMocks.getInboundEmailSetup
}));

vi.mock("@/components/inbound-email/EmailSetupPanel", () => ({
  EmailSetupPanel: pageMocks.panel
}));

vi.mock("@/lib/auth", () => ({
  requireAuth: pageMocks.requireAuth
}));

beforeEach(() => {
  vi.clearAllMocks();
  pageMocks.panel.mockImplementation(() => <div>Email setup panel</div>);
  pageMocks.requireAuth.mockResolvedValue({
    id: "page-auth-user-must-not-reach-client"
  });
});

describe("inbound email setup page", () => {
  it("passes only the safe serialized setup view to the client panel", async () => {
    pageMocks.getInboundEmailSetup.mockResolvedValue({
      ok: true,
      setup: {
        configured: true,
        mailbox: {
          address: "test-private@example.test",
          status: "ACTIVE",
          lastDisposition: "TEST_DRAFT_CREATED",
          lastReceivedAt: "2026-08-10T12:00:00.000Z",
          reviewCaptureKey: "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36"
        }
      },
      userId: "must-not-reach-the-client"
    });

    const markup = renderToStaticMarkup(await InboundEmailPage());

    expect(markup).toContain("Email setup panel");
    expect(pageMocks.panel).toHaveBeenCalledWith(
      {
        initialSetup: {
          configured: true,
          mailbox: {
            address: "test-private@example.test",
            status: "ACTIVE",
            lastDisposition: "TEST_DRAFT_CREATED",
            lastReceivedAt: "2026-08-10T12:00:00.000Z",
            reviewCaptureKey: "f7ea3ae4-8b56-49f5-a6e3-39c29fe8be36"
          }
        }
      },
      undefined
    );
    expect(markup).not.toContain("must-not-reach-the-client");
    expect(markup).not.toContain("page-auth-user-must-not-reach-client");
    expect(pageMocks.requireAuth).toHaveBeenCalledTimes(1);
  });

  it("shows a safe retryable load failure instead of missing configuration", async () => {
    pageMocks.getInboundEmailSetup.mockResolvedValue({
      ok: false,
      error: "Unable to load inbound email settings."
    });

    const markup = renderToStaticMarkup(await InboundEmailPage());

    expect(markup).toContain("Unable to load email forwarding.");
    expect(markup).toContain("Refresh this page to try again.");
    expect(markup).not.toContain("Inbound email testing is not connected");
    expect(pageMocks.panel).not.toHaveBeenCalled();
  });

  it("links both capture methods and marks email forwarding current", async () => {
    pageMocks.getInboundEmailSetup.mockResolvedValue({
      ok: true,
      setup: { configured: false, mailbox: null }
    });

    const markup = renderToStaticMarkup(await InboundEmailPage());

    expect(markup).toContain('href="/transactions/capture"');
    expect(markup).toContain("Quick and paste");
    expect(markup).toContain('href="/transactions/capture/email"');
    expect(markup).toContain("Email forwarding");
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/transactions\/capture\/email"/);
  });
});
