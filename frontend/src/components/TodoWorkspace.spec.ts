import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../types";
import TodoItem from "./TodoItem.vue";
import TodoWorkspace from "./TodoWorkspace.vue";

const todos: Todo[] = [
  {
    id: "line-1",
    title: "LINEから届いたTodo",
    done: false,
    tags: ["inbox"],
    createdAt: "2026-08-23T02:00:00.000Z",
    updatedAt: "2026-08-23T02:00:00.000Z",
  },
  {
    id: "work-1",
    title: "資料を仕上げる",
    done: false,
    tags: ["仕事"],
    createdAt: "2026-08-23T01:00:00.000Z",
    updatedAt: "2026-08-23T01:00:00.000Z",
  },
];

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  todoApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { todoApi } from "../api";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(todoApi.list).mockResolvedValue(todos);
  vi.mocked(todoApi.update).mockImplementation(async (_token, id, input) => {
    const updated = { ...todos.find((todo) => todo.id === id), ...input } as Todo;
    if (input.priority === null) delete updated.priority;
    return updated;
  });
});

describe("TodoWorkspace tag filtering", () => {
  it("shows dynamic tags and filters the visible todos", async () => {
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    expect(wrapper.text()).toContain("LINEから届いたTodo");
    expect(wrapper.text()).toContain("資料を仕上げる");

    await wrapper.get(".tag-filter-button:nth-of-type(2)").trigger("click");

    expect(wrapper.text()).toContain("LINEから届いたTodo");
    expect(wrapper.text()).not.toContain("資料を仕上げる");
  });
});

describe("TodoWorkspace priority board", () => {
  it("orders priority lanes from high to unassigned", async () => {
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    expect(wrapper.findAll(".priority-lane h2").map((heading) => heading.text())).toEqual([
      "高",
      "中",
      "小",
      "未設定",
    ]);
  });

  it("uses priority lanes without repeating the priority label on each unfinished todo", async () => {
    vi.mocked(todoApi.list).mockResolvedValueOnce([{ ...todos[0], priority: "high" }]);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    expect(wrapper.get(".priority-lane-high").text()).toContain("LINEから届いたTodo");
    expect(wrapper.find(".priority-high").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("優先度 高");
  });

  it("moves a todo optimistically when its priority changes", async () => {
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();
    const lineTodo = todos[0];
    const lineItem = wrapper
      .findAllComponents(TodoItem)
      .find((item) => item.props("todo").id === lineTodo.id);

    lineItem?.vm.$emit("priorityChange", lineTodo, "high");
    await flushPromises();

    expect(todoApi.update).toHaveBeenCalledWith("id-token", "line-1", { priority: "high" });
    expect(wrapper.get(".priority-lane-high").text()).toContain("LINEから届いたTodo");
    expect(wrapper.get(".priority-lane-none").text()).not.toContain("LINEから届いたTodo");
  });

  it("restores focus to the moved drag handle after keyboard movement", async () => {
    const wrapper = mount(TodoWorkspace, {
      props: { token: "id-token" },
      attachTo: "body",
    });
    await flushPromises();
    const handle = wrapper.get("#priority-handle-line-1");
    (handle.element as typeof handle.element & { focus: () => void }).focus();

    await handle.trigger("keydown", { key: "ArrowUp" });
    await flushPromises();

    expect(wrapper.element.ownerDocument.activeElement?.id).toBe("priority-handle-line-1");
    expect(wrapper.get(".priority-lane-low").text()).toContain("LINEから届いたTodo");
    wrapper.unmount();
  });

  it("drops a standard todo into a stacked todo", async () => {
    const parent: Todo = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked",
      createdAt: "2026-08-23T03:00:00.000Z",
      updatedAt: "2026-08-23T03:00:00.000Z",
    };
    vi.mocked(todoApi.list).mockResolvedValueOnce([parent, todos[0]]);
    const wrapper = mount(TodoWorkspace, {
      props: { token: "id-token" },
      attachTo: "body",
    });
    await flushPromises();

    const stack = wrapper.get('[data-stack-parent="parent-1"]').element;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => stack),
    });

    const pointerEvent = (type: string) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
        button: { value: 0 },
        clientX: { value: 100 },
        clientY: { value: 100 },
      });
      return event;
    };

    wrapper.get("#priority-handle-line-1").element.dispatchEvent(pointerEvent("pointerdown"));
    document.dispatchEvent(pointerEvent("pointermove"));
    await flushPromises();
    expect(wrapper.get('[data-stack-parent="parent-1"]').classes()).toContain(
      "is-stack-drop-target",
    );

    document.dispatchEvent(pointerEvent("pointerup"));
    await flushPromises();

    expect(todoApi.update).toHaveBeenCalledWith("id-token", "line-1", {
      parentId: "parent-1",
      position: 0,
    });

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
    wrapper.unmount();
  });
});

describe("TodoWorkspace stacked child creation", () => {
  it("keeps a todo created from an opened stack inside that parent", async () => {
    const parent: Todo = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked",
      createdAt: "2026-08-23T03:00:00.000Z",
      updatedAt: "2026-08-23T03:00:00.000Z",
    };
    const child: Todo = {
      id: "child-1",
      title: "Cognitoを調べる",
      done: false,
      kind: "standard",
      parentId: parent.id,
      position: 0,
      createdAt: "2026-08-23T03:01:00.000Z",
      updatedAt: "2026-08-23T03:01:00.000Z",
    };
    vi.mocked(todoApi.list).mockResolvedValueOnce([parent]);
    vi.mocked(todoApi.create).mockResolvedValueOnce(child);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    await wrapper.get(".stack-toggle").trigger("click");
    await wrapper.get(".child-composer input").setValue(child.title);
    await wrapper.get(".child-composer").trigger("submit");
    await flushPromises();

    expect(todoApi.create).toHaveBeenCalledWith("id-token", {
      title: child.title,
      parentId: parent.id,
      position: 0,
    });
    expect(wrapper.get(".stack-children").text()).toContain(child.title);
    expect(wrapper.findAll('[data-stack-parent="parent-1"] > .todo-item')).toHaveLength(1);
  });

  it("repairs the relationship when an older create API omits parentId", async () => {
    const parent: Todo = {
      id: "parent-1",
      title: "学習計画",
      done: false,
      kind: "stacked",
      createdAt: "now",
      updatedAt: "now",
    };
    const rootResult: Todo = {
      id: "child-1",
      title: "資料を読む",
      done: false,
      kind: "standard",
      createdAt: "now",
      updatedAt: "now",
    };
    const repaired = { ...rootResult, parentId: parent.id, position: 0 };
    vi.mocked(todoApi.list).mockResolvedValueOnce([parent]);
    vi.mocked(todoApi.create).mockResolvedValueOnce(rootResult);
    vi.mocked(todoApi.update).mockResolvedValueOnce(repaired);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    await wrapper.get(".stack-toggle").trigger("click");
    await wrapper.get(".child-composer input").setValue(rootResult.title);
    await wrapper.get(".child-composer").trigger("submit");
    await flushPromises();

    expect(todoApi.update).toHaveBeenCalledWith("id-token", rootResult.id, {
      parentId: parent.id,
      position: 0,
    });
    expect(wrapper.get(".stack-children").text()).toContain(rootResult.title);
  });

  it("repairs the kind when an older create API omits stacked", async () => {
    const rootResult: Todo = {
      id: "parent-1",
      title: "学習計画",
      done: false,
      createdAt: "now",
      updatedAt: "now",
    };
    const repaired = { ...rootResult, kind: "stacked" as const };
    vi.mocked(todoApi.create).mockResolvedValueOnce(rootResult);
    vi.mocked(todoApi.update).mockResolvedValueOnce(repaired);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    wrapper.findComponent({ name: "TodoComposer" }).vm.$emit("create", {
      title: rootResult.title,
      kind: "stacked",
    });
    await flushPromises();

    expect(todoApi.update).toHaveBeenCalledWith("id-token", rootResult.id, {
      kind: "stacked",
    });
    expect(wrapper.text()).toContain("Stacked");
  });

  it("shows legacy children even when their parent has no kind", async () => {
    const parent: Todo = {
      id: "parent-1",
      title: "学習計画",
      done: false,
      createdAt: "now",
      updatedAt: "now",
    };
    const child: Todo = {
      id: "child-1",
      title: "資料を読む",
      done: false,
      parentId: parent.id,
      position: 0,
      createdAt: "later",
      updatedAt: "later",
    };
    vi.mocked(todoApi.list).mockResolvedValueOnce([parent, child]);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    expect(wrapper.find('[data-stack-parent="parent-1"]').exists()).toBe(true);
    await wrapper.get(".stack-toggle").trigger("click");
    expect(wrapper.get(".stack-children").text()).toContain(child.title);
  });
});

describe("TodoWorkspace completed list", () => {
  it("shows completed todos as a flat list with priority text and no move handle", async () => {
    vi.mocked(todoApi.list).mockResolvedValueOnce([
      ...todos,
      {
        id: "done-1",
        title: "完了したTodo",
        done: true,
        priority: "medium",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    ]);
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    await wrapper.findAll(".filter-button")[2].trigger("click");

    expect(wrapper.find(".priority-board").exists()).toBe(false);
    expect(wrapper.get(".completed-list").text()).toContain("完了したTodo");
    expect(wrapper.get(".completed-list").text()).toContain("優先度 中");
    expect(wrapper.find(".drag-handle").exists()).toBe(false);
    expect(wrapper.find(".delete-button").exists()).toBe(true);
  });
});

describe("TodoWorkspace completion recovery", () => {
  it("lets the user undo an accidental completion", async () => {
    const wrapper = mount(TodoWorkspace, { props: { token: "id-token" } });
    await flushPromises();

    await wrapper.findAll(".check-button")[0].trigger("click");
    await flushPromises();

    expect(todoApi.update).toHaveBeenCalledWith("id-token", "line-1", { done: true });
    expect(wrapper.text()).not.toContain("LINEから届いたTodo");
    expect(wrapper.get(".undo-toast").text()).toContain("Todoを完了にしました");

    await wrapper.get(".undo-toast button").trigger("click");
    await flushPromises();

    expect(todoApi.update).toHaveBeenLastCalledWith("id-token", "line-1", { done: false });
    expect(wrapper.text()).toContain("LINEから届いたTodo");
    wrapper.unmount();
  });
});
