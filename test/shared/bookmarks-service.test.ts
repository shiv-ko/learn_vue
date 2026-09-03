import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

vi.mock("../../src/shared/bookmarks-repository", () => ({
  registerBookmark: vi.fn(),
}));

import { registerBookmark } from "../../src/shared/bookmarks-repository";
import { registerBookmarkBatch } from "../../src/shared/bookmarks-service";

process.env.BOOKMARK_METADATA_QUEUE_URL = "https://sqs.example.test/metadata";

const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  vi.clearAllMocks();
  sqsMock.reset();
  sqsMock.on(SendMessageCommand).resolves({});
});

describe("registerBookmarkBatch", () => {
  it("keeps item order and reports invalid URLs without failing valid items", async () => {
    vi.mocked(registerBookmark).mockImplementation(async (input) => ({
      created: true,
      bookmark: {
        id: input.url.includes("one") ? "one" : "two",
        url: input.url,
        normalizedUrl: input.url,
        status: "inbox",
        tags: [],
        favorite: false,
        source: input.source,
        metadataStatus: "pending",
        createdAt: "now",
        updatedAt: "now",
      },
    }));

    const results = await registerBookmarkBatch({
      items: [
        { url: "https://example.com/one" },
        { url: "not-a-url" },
        { url: "https://example.com/two" },
      ],
      source: "android",
    });

    expect(results).toEqual([
      { url: "https://example.com/one", status: "created", id: "one" },
      { url: "not-a-url", status: "invalid" },
      { url: "https://example.com/two", status: "created", id: "two" },
    ]);
    expect(registerBookmark).toHaveBeenCalledTimes(2);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(2);
  });
});
