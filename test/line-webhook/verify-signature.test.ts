import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../../src/line-webhook/verify-signature";

const SECRET = "test-channel-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const body = JSON.stringify({ events: [] });

    expect(verifySignature(SECRET, body, sign(body))).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = JSON.stringify({ events: [] });

    expect(verifySignature(SECRET, body, "invalid-signature")).toBe(false);
  });

  it("returns false when the body does not match the signature", () => {
    const signedBody = JSON.stringify({ events: [] });
    const tamperedBody = JSON.stringify({ events: [{ type: "message" }] });

    expect(verifySignature(SECRET, tamperedBody, sign(signedBody))).toBe(false);
  });
});
