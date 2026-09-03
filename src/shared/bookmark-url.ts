import { createHash } from "crypto";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:、。！？；：】」』〉》）]$/u;

export function normalizeBookmarkUrl(value: string): string | null {
  if (value.length === 0 || value.length > 2_048) return null;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function bookmarkId(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

export function extractUrls(text: string, limit = 20): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    let candidate = match[0];
    while (TRAILING_PUNCTUATION.test(candidate)) candidate = candidate.slice(0, -1);
    if (normalizeBookmarkUrl(candidate)) urls.push(candidate);
    if (urls.length === limit) break;
  }
  return urls;
}

export function extractMemo(text: string): string | undefined {
  const memo = text
    .replace(URL_PATTERN, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return memo || undefined;
}
