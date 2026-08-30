import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TodoComposer from "./TodoComposer.vue";

describe("TodoComposer", () => {
  it("creates a todo with an optional markdown note", async () => {
    const wrapper = mount(TodoComposer, { props: { saving: false } });
    await wrapper.get("#todo-title").setValue("Cognitoを調べる");
    await wrapper.get("#todo-title").trigger("focus");
    await wrapper.get("#todo-note").setValue("# 理解したいこと\n認証の流れを順に学びたい");

    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("create")?.[0]).toEqual([
      {
        title: "Cognitoを調べる",
        note: "# 理解したいこと\n認証の流れを順に学びたい",
        tags: [],
        kind: "standard",
      },
    ]);
  });

  it("creates a stacked todo when that type is selected", async () => {
    const wrapper = mount(TodoComposer, { props: { saving: false } });
    await wrapper.get("#todo-title").setValue("パスキーについて学ぶ");
    await wrapper.get("#todo-title").trigger("focus");
    await wrapper.get('input[value="stacked"]').setValue(true);

    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("create")?.[0]?.[0]).toMatchObject({
      title: "パスキーについて学ぶ",
      kind: "stacked",
    });
  });
});
