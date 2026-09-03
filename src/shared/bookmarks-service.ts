import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { normalizeBookmarkUrl } from "./bookmark-url";
import { registerBookmark } from "./bookmarks-repository";
import type {
  BookmarkRegistrationResult,
  BookmarkSource,
  BookmarkStatus,
} from "./types";

const sqs = new SQSClient({});

interface BatchRegistrationInput {
  items: Array<{ url: unknown }>;
  tags?: string[];
  memo?: string;
  status?: BookmarkStatus;
  source: BookmarkSource;
}

export async function registerBookmarkBatch(
  input: BatchRegistrationInput,
): Promise<BookmarkRegistrationResult[]> {
  return Promise.all(
    input.items.map(async (item): Promise<BookmarkRegistrationResult> => {
      if (typeof item?.url !== "string" || !normalizeBookmarkUrl(item.url)) {
        return {
          url: typeof item?.url === "string" ? item.url : "",
          status: "invalid",
        };
      }

      const { bookmark, created } = await registerBookmark({
        url: item.url,
        tags: input.tags,
        memo: input.memo,
        status: input.status,
        source: input.source,
      });
      if (bookmark.metadataStatus !== "ready") {
        await enqueueMetadata(bookmark.id, bookmark.url);
      }
      return {
        url: item.url,
        status: created ? "created" : "existing",
        id: bookmark.id,
      };
    }),
  );
}

export async function enqueueMetadata(id: string, url: string): Promise<void> {
  const queueUrl = process.env.BOOKMARK_METADATA_QUEUE_URL;
  if (!queueUrl) throw new Error("BOOKMARK_METADATA_QUEUE_URL is not set");
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ id, url }),
    }),
  );
}
