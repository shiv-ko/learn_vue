import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import TodoItem from "./TodoItem.vue";

const todo: Todo = {
  id: "todo-1",
  title: "請求書を確認する",
  done: false,
  priority: "high",
  tags: ["仕事", "今週"],
  dueDate: "2026-08-24",
  note: "# 理解したいこと\n請求処理の流れを順に学ぶ",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

describe("TodoItem", () => {
  it("emits a toggle request from the accessible checkbox", async () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    await wrapper.get(".check-button").trigger("click");
    expect(wrapper.emitted("toggle")?.[0]).toEqual([todo]);
  });

  it("does not offer deletion for an unfinished todo", () => {
    const wrapper = mount(TodoItem, { props: { todo } });

    expect(wrapper.find(".delete-button").exists()).toBe(false);
  });

  it("offers deletion only after a todo is completed", async () => {
    const completed = { ...todo, done: true };
    const wrapper = mount(TodoItem, { props: { todo: completed, deletable: true } });

    await wrapper.get(".delete-button").trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual([completed]);
  });

  it("does not offer deletion for a completed todo outside the completed view", () => {
    const completed = { ...todo, done: true };
    const wrapper = mount(TodoItem, { props: { todo: completed } });

    expect(wrapper.find(".delete-button").exists()).toBe(false);
  });

  it("renders every assigned tag", () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    expect(wrapper.findAll(".tag-chip").map((chip) => chip.text())).toEqual([
      "仕事",
      "今週",
    ]);
  });

  it("does not show the markdown note in the todo list", () => {
    const wrapper = mount(TodoItem, { props: { todo } });

    expect(wrapper.text()).not.toContain("請求処理の流れを順に学ぶ");
  });

  it("hides the priority label when the surrounding lane already shows it", () => {
    const wrapper = mount(TodoItem, { props: { todo, showPriority: false } });

    expect(wrapper.find(".priority-high").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("優先度 高");
    expect(wrapper.text()).toContain("請求書を確認する");
  });

  it("hides the move handle when priority movement is disabled", () => {
    const wrapper = mount(TodoItem, { props: { todo, movable: false } });

    expect(wrapper.find(".drag-handle").exists()).toBe(false);
  });

  it("opens inline editing and emits changed values", async () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    await wrapper.get(".todo-content").trigger("click");
    await wrapper.get(`#edit-title-${todo.id}`).setValue("請求書を送付する");
    await wrapper.get(".edit-form").trigger("submit");

    expect(wrapper.emitted("update")?.[0]).toEqual([
      todo,
      {
        title: "請求書を送付する",
        dueDate: "2026-08-24",
        priority: "high",
        memo: "",
        note: "# 理解したいこと\n請求処理の流れを順に学ぶ",
        tags: ["仕事", "今週"],
        kind: "standard",
      },
    ]);
  });

  it("edits the markdown note from the todo details", async () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    await wrapper.get(".todo-content").trigger("click");
    await wrapper.get(`#edit-note-${todo.id}`).setValue("# 次に学ぶこと\n会計処理を確認する");
    await wrapper.get(".edit-form").trigger("submit");

    expect(wrapper.emitted("update")?.[0]?.[1]).toMatchObject({
      note: "# 次に学ぶこと\n会計処理を確認する",
    });
  });

  it("clears priority from inline editing", async () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    await wrapper.get(".todo-content").trigger("click");
    await wrapper.findAll(".edit-details select")[1].setValue("");
    await wrapper.get(".edit-form").trigger("submit");

    expect(wrapper.emitted("update")?.[0]?.[1]).toMatchObject({ priority: null });
  });

  it("moves priority with the keyboard", async () => {
    const wrapper = mount(TodoItem, { props: { todo } });
    await wrapper.get(".drag-handle").trigger("keydown", { key: "ArrowDown" });

    expect(wrapper.emitted("priorityChange")?.[0]).toEqual([todo, "medium"]);
  });
});
