import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import type { Todo } from "../types";
import ExecutionPlan from "./ExecutionPlan.vue";

const STORAGE_KEY = "todo.execution-plan.v1";
const todos: Todo[] = [
  {
    id: "first",
    title: "資料を読む",
    done: false,
    priority: "medium",
    dueDate: "2026-10-05",
    tags: ["読書", "設計"],
    memo: "3章まで読み進める",
    note: "状態管理の境界を整理する",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  },
  {
    id: "second",
    title: "設計を書く",
    done: false,
    priority: "high",
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  },
  {
    id: "done",
    title: "完了済み",
    done: true,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  },
];

beforeEach(() => {
  window.localStorage.clear();
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

describe("ExecutionPlan", () => {
  it("restores only planned unfinished todos in their saved order", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["second", "done", "first"]));

    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
    });

    expect(wrapper.findAll(".plan-item h2").map((heading) => heading.text())).toEqual([
      "設計を書く",
      "資料を読む",
    ]);
    expect(wrapper.get(".plan-heading .eyebrow").text()).toBe("EXECUTION PLAN");
    expect(wrapper.text()).not.toContain("次にやることだけを、上から順に並べます。");
    expect(wrapper.text()).not.toContain("完了済み");
  });

  it("adds a todo to the end and persists it locally", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["first"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
      attachTo: "body",
    });

    await wrapper.get("#plan-todo-select").setValue("second");
    await wrapper.get(".plan-add").trigger("submit");

    expect(wrapper.findAll(".plan-item h2").map((heading) => heading.text())).toEqual([
      "資料を読む",
      "設計を書く",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "first",
      "second",
    ]);
    wrapper.unmount();
  });

  it("reorders with the keyboard and keeps focus on the moved todo", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["first", "second"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
      attachTo: "body",
    });
    const handle = wrapper.get("#plan-handle-second");
    (handle.element as HTMLButtonElement).focus();

    await handle.trigger("keydown", { key: "ArrowUp" });

    expect(wrapper.findAll(".plan-item h2").map((heading) => heading.text())).toEqual([
      "設計を書く",
      "資料を読む",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "second",
      "first",
    ]);
    expect(document.activeElement?.id).toBe("plan-handle-second");
    wrapper.unmount();
  });

  it("reorders visible todos while retaining a completed todo's saved slot", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["done", "first", "second"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
    });

    await wrapper.get("#plan-handle-first").trigger("keydown", { key: "ArrowDown" });

    expect(wrapper.findAll(".plan-item h2").map((heading) => heading.text())).toEqual([
      "設計を書く",
      "資料を読む",
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([
      "done",
      "second",
      "first",
    ]);
  });

  it("removes a todo from the plan without deleting the todo", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["first"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
    });

    await wrapper.get(".plan-remove-button").trigger("click");

    expect(wrapper.find(".plan-item").exists()).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([]);
    expect(wrapper.emitted("toggle")).toBeUndefined();
  });

  it("delegates completion to the existing todo flow", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["first"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
    });

    await wrapper.get(".plan-complete-button").trigger("click");

    expect(wrapper.emitted("toggle")?.[0]).toEqual([todos[0]]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(["first"]);
  });

  it("opens the planned todo details in a modal", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["first"]));
    const wrapper = mount(ExecutionPlan, {
      props: { todos, busyIds: new Set<string>() },
      attachTo: "body",
    });

    await wrapper.get(".plan-detail-button").trigger("click");

    const dialog = wrapper.get(".plan-detail-dialog");
    expect(dialog.attributes()).toHaveProperty("open");
    expect(dialog.text()).toContain("資料を読む");
    expect(dialog.text()).toContain("2026年10月5日");
    expect(dialog.text()).toContain("優先度");
    expect(dialog.text()).toContain("中");
    expect(dialog.text()).toContain("読書");
    expect(dialog.text()).toContain("3章まで読み進める");
    expect(dialog.text()).toContain("状態管理の境界を整理する");

    await wrapper.get(".plan-detail-close").trigger("click");
    expect(dialog.attributes()).not.toHaveProperty("open");
    wrapper.unmount();
  });
});
