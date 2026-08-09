import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout, { metadata } from "@/app/layout";
import { GET } from "@/app/favicon.ico/route";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-variable" });
  return {
    Be_Vietnam_Pro: font,
    IBM_Plex_Mono: font,
    Inter: font,
    Space_Grotesk: font
  };
});

describe("application shell", () => {
  it("declares the document's existing smooth-scroll behavior for Next navigation", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main>Content</main>
      </RootLayout>
    );

    expect(markup).toContain('data-scroll-behavior="smooth"');
  });

  it("serves and advertises a cacheable favicon instead of returning 404", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    expect(await response.text()).toContain("<svg");
    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });
});
