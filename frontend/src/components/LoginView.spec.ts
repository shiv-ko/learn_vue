import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LoginView from "./LoginView.vue";

describe("LoginView", () => {
  it("submits the entered Cognito credentials", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(LoginView, { props: { login } });

    await wrapper.get("#email").setValue("user@example.com");
    await wrapper.get("#password").setValue("secret-password");
    await wrapper.get("form").trigger("submit");

    expect(login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret-password",
    });
  });

  it("shows a helpful authentication error", async () => {
    const login = vi.fn().mockRejectedValue(new Error("メールアドレスまたはパスワードが違います。"));
    const wrapper = mount(LoginView, { props: { login } });

    await wrapper.get("#email").setValue("user@example.com");
    await wrapper.get("#password").setValue("wrong-password");
    await wrapper.get("form").trigger("submit");
    await vi.waitFor(() => expect(wrapper.get("[role='alert']").text()).toContain("パスワード"));
  });
});

