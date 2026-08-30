import { describe, expect, it } from "vitest";
import { formatTagInput, parseTagInput } from "./tags";

describe("tag helpers", () => {
  it("accepts Japanese and ASCII commas and removes duplicates", () => {
    expect(parseTagInput("仕事, 今週、仕事,  買い物 ")).toEqual([
      "仕事",
      "今週",
      "買い物",
    ]);
  });

  it("formats stored tags for editing", () => {
    expect(formatTagInput(["inbox", "仕事"])).toBe("inbox, 仕事");
  });
});
