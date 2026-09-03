import { describe, expect, it } from "vitest";
import {
  bookmarkId,
  extractMemo,
  extractUrls,
  normalizeBookmarkUrl,
} from "../../src/shared/bookmark-url";

describe("normalizeBookmarkUrl", () => {
  it("normalizes scheme, host, default port, and fragment while preserving query", () => {
    expect(normalizeBookmarkUrl("HTTPS://Example.COM:443/article?q=1#section")).toBe(
      "https://example.com/article?q=1",
    );
  });

  it("rejects unsupported schemes and credentials", () => {
    expect(normalizeBookmarkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBookmarkUrl("https://user:pass@example.com/")).toBeNull();
  });

  it("produces the same ID for equivalent URLs", () => {
    const first = normalizeBookmarkUrl("https://EXAMPLE.com:443/a#one")!;
    const second = normalizeBookmarkUrl("https://example.com/a#two")!;
    expect(bookmarkId(first)).toBe(bookmarkId(second));
  });
});

describe("LINE text extraction", () => {
  it("extracts URL punctuation safely and retains non-URL memo text", () => {
    const text = "あとで読む。\nhttps://example.com/a。\nhttps://example.com/b?q=1";
    expect(extractUrls(text)).toEqual([
      "https://example.com/a",
      "https://example.com/b?q=1",
    ]);
    expect(extractMemo(text)).toBe("あとで読む。");
  });
});
