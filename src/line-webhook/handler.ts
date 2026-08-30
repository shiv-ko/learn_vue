import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { verifySignature } from "./verify-signature";
import { createTodo } from "../shared/todos-repository";

interface LineMessageEvent {
  type: string;
  message?: { type: string; text?: string };
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";
  const signature =
    event.headers["x-line-signature"] ?? event.headers["X-Line-Signature"] ?? "";
  const body = event.body ?? "";

  if (!verifySignature(channelSecret, body, signature)) {
    return { statusCode: 401, body: JSON.stringify({ message: "invalid signature" }) };
  }

  const parsed = JSON.parse(body) as { events?: LineMessageEvent[] };
  const events = parsed.events ?? [];

  for (const lineEvent of events) {
    if (
      lineEvent.type === "message" &&
      lineEvent.message?.type === "text" &&
      lineEvent.message.text
    ) {
      await createTodo({ title: lineEvent.message.text, tags: ["inbox"] });
    }
  }

  return { statusCode: 200, body: "" };
}
