import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Todo } from "../types";
import StackedTodoItem from "./StackedTodoItem.vue";

const parent: Todo = {
  id: "parent-1",
  title: "パスキーについて学ぶ",
  done: false,
  kind: "stacked",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

const children: Todo[] = [
  {
    id: "child-1",
    title: "WebAuthnを理解する",
    done: true,
    kind: "standard",
    parentId: parent.id,
    position: 0,
    createdAt: "2026-08-27T00:01:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
  },
  {
    id: "child-2",
    title: "試作を動かす",
    done: false,
    kind: "standard",
    parentId: parent.id,
    position: 1,
    createdAt: "2026-08-27T00:02:00.000Z",
    updatedAt: "2026-08-27T00:02:00.000Z",
  },
];

describe("StackedTodoItem", () => {
  it("allows deleting an unfinished stacked todo", async () => {
    const wrapper = mount(StackedTodoItem, {
      props: { todo: parent, children, parents: [parent], busyIds: new Set<string>() },
    });

    await wrapper.get(".delete-button").trigger("click");

    expect(wrapper.emitted("remove")?.[0]).toEqual([parent]);
  });

  it("keeps children closed by default and shows progress", async () => {
    const wrapper = mount(StackedTodoItem, {
      props: { todo: parent, children, parents: [parent], busyIds: new Set<string>() },
    });

    expect(wrapper.get(".stack-toggle").text()).toContain("1/2 完了");
    expect(wrapper.get(".stack-children").isVisible()).toBe(false);

    await wrapper.get(".stack-toggle").trigger("click");

    expect(wrapper.get(".stack-toggle").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".stack-children").attributes("style") ?? "").not.toContain("display: none");
    expect(wrapper.text()).toContain("WebAuthnを理解する");
    expect(wrapper.text()).toContain("試作を動かす");
  });

  it("adds and reorders child todos", async () => {
    const wrapper = mount(StackedTodoItem, {
      props: { todo: parent, children, parents: [parent], busyIds: new Set<string>() },
    });
    await wrapper.get(".stack-toggle").trigger("click");
    await wrapper.get(".child-composer input").setValue("Cognitoを調べる");
    await wrapper.get(".child-composer").trigger("submit");
    await wrapper.findAll('.child-structure-actions button[aria-label$="を上へ移動"]')[1].trigger("click");

    expect(wrapper.emitted("createChild")?.[0]?.[0]).toMatchObject({
      title: "Cognitoを調べる",
      parentId: parent.id,
      position: 2,
    });
    expect(wrapper.emitted("reorderChild")?.[0]).toEqual([children[1], 0]);
  });

  it("expands and highlights itself while it is a drag destination", async () => {
    const wrapper = mount(StackedTodoItem, {
      props: { todo: parent, children, parents: [parent], busyIds: new Set<string>() },
    });

    await wrapper.setProps({ dropTarget: true });

    expect(wrapper.classes()).toContain("is-stack-drop-target");
    expect(wrapper.get(".stack-toggle").text()).toContain("ここに入れる");
    expect(wrapper.get(".stack-toggle").attributes("aria-expanded")).toBe("true");
  });

  it("returns a child to the regular todo list", async () => {
    const wrapper = mount(StackedTodoItem, {
      props: { todo: parent, children, parents: [parent], busyIds: new Set<string>() },
    });
    await wrapper.get(".stack-toggle").trigger("click");

    await wrapper.findAll(".child-structure-actions select")[0].setValue("");

    expect(wrapper.emitted("moveChild")?.[0]).toEqual([children[0], null]);
  });
});
