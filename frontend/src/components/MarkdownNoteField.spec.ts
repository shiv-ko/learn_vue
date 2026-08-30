import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import MarkdownNoteField from "./MarkdownNoteField.vue";

describe("MarkdownNoteField", () => {
  it("updates the markdown value", async () => {
    const wrapper = mount(MarkdownNoteField, {
      props: { id: "note", modelValue: "" },
    });

    await wrapper.get("textarea").setValue("# Cognito\n認証の流れを理解したい");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([
      "# Cognito\n認証の流れを理解したい",
    ]);
  });

  it("copies the note and reports success on the button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    const note = "# 認証\n前提から順に理解したい";
    const wrapper = mount(MarkdownNoteField, {
      props: { id: "note", modelValue: note },
    });

    await wrapper.get(".note-copy-button").trigger("click");
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith(note);
    expect(wrapper.get(".note-copy-button").text()).toBe("コピー済み");
  });

  it("disables copying when the note is empty", () => {
    const wrapper = mount(MarkdownNoteField, {
      props: { id: "note", modelValue: "" },
    });

    expect(wrapper.get(".note-copy-button").attributes("disabled")).toBeDefined();
  });
});
