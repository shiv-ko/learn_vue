import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";

vi.mock("./auth", () => ({
  getCurrentToken: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { getCurrentToken } from "./auth";

const TodoWorkspaceStub = {
  props: ["token", "view"],
  emits: ["logout", "showTodos", "showPlan", "showBookmarks"],
  template: `
    <section data-testid="todo-workspace" :data-view="view">
      <button data-testid="show-bookmarks" @click="$emit('showBookmarks')">あとで読む</button>
    </section>
  `,
};

const BookmarkWorkspaceStub = {
  props: ["token"],
  emits: ["logout", "showTodos", "showPlan"],
  template: `
    <section data-testid="bookmark-workspace">
      <button data-testid="show-plan" @click="$emit('showPlan')">実行順</button>
    </section>
  `,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentToken).mockResolvedValue("id-token");
});

describe("App view navigation", () => {
  it("moves from bookmarks to the execution plan", async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          TodoWorkspace: TodoWorkspaceStub,
          BookmarkWorkspace: BookmarkWorkspaceStub,
          LoginView: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.get('[data-testid="todo-workspace"]').attributes("data-view")).toBe("todos");
    await wrapper.get('[data-testid="show-bookmarks"]').trigger("click");
    expect(wrapper.find('[data-testid="bookmark-workspace"]').exists()).toBe(true);

    await wrapper.get('[data-testid="show-plan"]').trigger("click");
    expect(wrapper.get('[data-testid="todo-workspace"]').attributes("data-view")).toBe("plan");
  });
});
