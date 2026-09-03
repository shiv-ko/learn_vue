import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookmarkWorkspace from "./BookmarkWorkspace.vue";
import { bookmarkApi } from "../api";
import type { Bookmark } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    bookmarkApi: {
      list: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

const items: Bookmark[] = [
  {
    id: "one",
    url: "https://example.com/typescript",
    normalizedUrl: "https://example.com/typescript",
    title: "TypeScriptの記事",
    siteName: "Example",
    status: "inbox",
    tags: ["技術"],
    memo: "週末に読む",
    favorite: false,
    source: "line",
    metadataStatus: "ready",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "two",
    url: "https://news.example.com/design",
    normalizedUrl: "https://news.example.com/design",
    title: "デザインの記事",
    status: "read",
    tags: ["デザイン"],
    favorite: true,
    source: "android",
    metadataStatus: "pending",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bookmarkApi.list).mockResolvedValue(items);
  vi.mocked(bookmarkApi.update).mockImplementation(async (_token, id, input) => ({
    ...items.find((item) => item.id === id)!,
    ...input,
    updatedAt: "later",
  } as Bookmark));
  vi.mocked(bookmarkApi.remove).mockResolvedValue(undefined);
});

describe("BookmarkWorkspace", () => {
  it("lists bookmarks and filters by keyword and tag", async () => {
    const wrapper = mount(BookmarkWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    expect(wrapper.text()).toContain("TypeScriptの記事");
    expect(wrapper.text()).toContain("デザインの記事");

    await wrapper.get('input[type="search"]').setValue("週末");
    expect(wrapper.text()).toContain("TypeScriptの記事");
    expect(wrapper.text()).not.toContain("デザインの記事");

    await wrapper.get('input[type="search"]').setValue("");
    const designTag = wrapper.findAll(".tag-filter-button").find((button) => button.text().includes("デザイン"));
    await designTag!.trigger("click");
    expect(wrapper.text()).not.toContain("TypeScriptの記事");
    expect(wrapper.text()).toContain("デザインの記事");
    wrapper.unmount();
  });

  it("updates favorite and status", async () => {
    const wrapper = mount(BookmarkWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    const card = wrapper.findAll(".bookmark-card").find((item) => item.text().includes("TypeScript"))!;
    await card.get(".favorite-button").trigger("click");
    await card.get(".status-select select").setValue("reading");

    expect(bookmarkApi.update).toHaveBeenCalledWith("id-token", "one", { favorite: true });
    expect(bookmarkApi.update).toHaveBeenCalledWith("id-token", "one", { status: "reading" });
    wrapper.unmount();
  });

  it("opens the editor and saves title, URL, memo, and tags", async () => {
    const wrapper = mount(BookmarkWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    const card = wrapper.findAll(".bookmark-card").find((item) => item.text().includes("TypeScript"))!;
    await card.findAll(".bookmark-actions .text-button")[0].trigger("click");
    const form = wrapper.get(".bookmark-edit");
    const inputs = form.findAll("input");
    await inputs[0].setValue("更新したタイトル");
    await inputs[2].setValue("技術, 後で, 技術");
    await form.get("textarea").setValue("更新メモ");
    await form.trigger("submit");

    expect(bookmarkApi.update).toHaveBeenCalledWith("id-token", "one", {
      title: "更新したタイトル",
      url: "https://example.com/typescript",
      memo: "更新メモ",
      tags: ["技術", "後で"],
    });
    wrapper.unmount();
  });
});
