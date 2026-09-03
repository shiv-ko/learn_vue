import { isIP } from "net";
import { lookup } from "dns/promises";
import type { SQSEvent } from "aws-lambda";
import { normalizeBookmarkUrl } from "../shared/bookmark-url";
import { updateBookmarkMetadata } from "../shared/bookmarks-repository";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface MetadataJob {
  id: string;
  url: string;
}

interface PageMetadata {
  title: string;
  description?: string;
  siteName: string;
  imageUrl?: string;
}

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    let job: MetadataJob | null = null;
    try {
      job = parseJob(record.body);
      if (!job) throw new Error("invalid metadata job");
      const metadata = await fetchPageMetadata(job.url);
      await updateBookmarkMetadata(job.id, { status: "ready", ...metadata });
    } catch (error) {
      console.error("bookmark metadata fetch failed", error);
      if (job) await updateBookmarkMetadata(job.id, { status: "failed" });
    }
  }
}

export async function fetchPageMetadata(initialUrl: string): Promise<PageMetadata> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicHttpUrl(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "TodoBookmarkMetadata/1.0",
      },
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("too many redirects");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`metadata response ${response.status}`);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("metadata response is not HTML");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("metadata response is too large");
    }

    const html = await readLimitedText(response, MAX_RESPONSE_BYTES);
    return parseMetadata(html, currentUrl);
  }

  throw new Error("too many redirects");
}

export async function assertPublicHttpUrl(value: string): Promise<void> {
  const normalized = normalizeBookmarkUrl(value);
  if (!normalized) throw new Error("unsupported URL");
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("local hostname is not allowed");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isForbiddenAddress(address))) {
    throw new Error("private or local address is not allowed");
  }
}

function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isForbiddenAddress(normalized.slice("::ffff:".length));
  }
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith("ff")
    );
  }
  return true;
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("metadata response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseMetadata(html: string, pageUrl: string): PageMetadata {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.property ?? attributes.name ?? "").toLowerCase();
    if (key && attributes.content && !meta.has(key)) meta.set(key, decodeHtml(attributes.content));
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
  const fallbackTitle = titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]+>/gu, "").trim()) : "";
  const url = new URL(pageUrl);
  const image = meta.get("og:image");
  let imageUrl: string | undefined;
  if (image) {
    try {
      const resolved = new URL(image, pageUrl).toString();
      if (normalizeBookmarkUrl(resolved)) imageUrl = resolved;
    } catch {
      // Ignore malformed image URLs.
    }
  }

  return {
    title: meta.get("og:title") || fallbackTitle || pageUrl,
    ...(meta.get("og:description") || meta.get("description")
      ? { description: meta.get("og:description") || meta.get("description") }
      : {}),
    siteName: meta.get("og:site_name") || url.hostname,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .trim();
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseJob(body: string): MetadataJob | null {
  try {
    const parsed = JSON.parse(body) as Partial<MetadataJob>;
    return typeof parsed.id === "string" && typeof parsed.url === "string"
      ? { id: parsed.id, url: parsed.url }
      : null;
  } catch {
    return null;
  }
}
