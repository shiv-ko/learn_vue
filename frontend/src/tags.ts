export function parseTagInput(value: string): string[] {
  const tags = value
    .split(/[,、]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);

  return [...new Map(tags.map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
}

export function formatTagInput(tags?: string[]): string {
  return tags?.join(", ") ?? "";
}
