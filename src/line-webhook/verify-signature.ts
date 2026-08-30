import { createHmac, timingSafeEqual } from "crypto";

export function verifySignature(
  channelSecret: string,
  body: string,
  signature: string,
): boolean {
  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
