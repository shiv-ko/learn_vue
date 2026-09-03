import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({
  lookup: vi.fn(),
}));
vi.mock("../../src/shared/bookmarks-repository", () => ({
  updateBookmarkMetadata: vi.fn(),
}));

import { lookup } from "dns/promises";
import { assertPublicHttpUrl, fetchPageMetadata } from "../../src/bookmark-metadata/handler";

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(lookup).mockReset();
});

describe("assertPublicHttpUrl", () => {
  it("rejects localhost and private DNS results", async () => {
    await expect(assertPublicHttpUrl("http://localhost/test")).rejects.toThrow(/local/);
    vi.mocked(lookup).mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
    await expect(assertPublicHttpUrl("https://metadata.example/test")).rejects.toThrow(/private/);
  });

  it("accepts public addresses", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertPublicHttpUrl("https://example.com/test")).resolves.toBeUndefined();
  });
});

describe("fetchPageMetadata", () => {
  it("uses OG fields first and resolves an image URL", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`
      <html><head>
        <title>Fallback</title>
        <meta content="OG title" property="og:title">
        <meta name="description" content="A &amp; B">
        <meta property="og:site_name" content="Example">
        <meta property="og:image" content="/cover.jpg">
      </head></html>
    `, { status: 200, headers: { "content-type": "text/html" } })));

    await expect(fetchPageMetadata("https://example.com/article")).resolves.toEqual({
      title: "OG title",
      description: "A & B",
      siteName: "Example",
      imageUrl: "https://example.com/cover.jpg",
    });
  });

  it("rejects non-HTML responses", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } }),
    ));
    await expect(fetchPageMetadata("https://example.com/file")).rejects.toThrow(/not HTML/);
  });
});
