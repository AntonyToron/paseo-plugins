import type { DiffLine } from "../shared/review";
import { highlightable, highlightLines, wordChanges, type Token } from "./vendor/text";

export interface Segment {
  text: string;
  /** Prism's token type, for the colour. */
  type: string | null;
  /** Part of what changed on a line edited in place, as GitHub marks it. */
  changed: boolean;
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  py: "python",
  go: "go",
  rs: "rust",
  toml: "toml",
  graphql: "graphql",
  gql: "graphql",
  html: "markup",
  xml: "markup",
  svg: "markup",
};

export function languageFor(path: string): string | null {
  const name = path.split("/").at(-1) ?? path;
  if (name === "Dockerfile" || name.endsWith(".Dockerfile")) return "docker";
  const language = LANGUAGES[name.split(".").at(-1)?.toLowerCase() ?? ""];
  return language && highlightable(language) ? language : null;
}

// Minified bundles and huge generated files would stall the screen for no reading benefit.
const MAX_BLOCK_CHARS = 200_000;
const MAX_WORD_DIFF_CHARS = 500;
// Below this share of common characters, two lines are a rewrite rather than an edit, and
// marking every word would only be noise.
const MIN_SIMILARITY = 0.5;

const code = (line: DiffLine) =>
  line.kind === "add" || line.kind === "remove" || line.kind === "context";

/**
 * Colours each side of a hunk as one block, so a comment or string that spans lines stays one;
 * context lines take the new side's colours.
 */
function highlightHunks(lines: readonly DiffLine[], language: string): (Token[] | null)[] {
  const tokens: (Token[] | null)[] = lines.map(() => null);
  const color = (indexes: number[], assign: (index: number) => boolean) => {
    const block = indexes.map((index) => lines[index]!.text).join("\n");
    if (!block || block.length > MAX_BLOCK_CHARS) return;
    highlightLines(block, language).forEach((lineTokens, position) => {
      const index = indexes[position];
      if (index !== undefined && assign(index)) tokens[index] = lineTokens;
    });
  };
  let start = 0;
  for (let end = 0; end <= lines.length; end++) {
    if (end < lines.length && lines[end]!.kind !== "hunk") continue;
    const hunk = Array.from({ length: end - start }, (_, offset) => start + offset);
    color(
      hunk.filter((index) => lines[index]!.kind === "add" || lines[index]!.kind === "context"),
      () => true,
    );
    color(
      hunk.filter((index) => lines[index]!.kind === "remove" || lines[index]!.kind === "context"),
      (index) => lines[index]!.kind === "remove",
    );
    start = end + 1;
  }
  return tokens;
}

/** Pairs each run of removed lines with the added lines after it, as GitHub does. */
function editedRanges(lines: readonly DiffLine[]): ([number, number][] | null)[] {
  const ranges: ([number, number][] | null)[] = lines.map(() => null);
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind !== "remove") {
      index++;
      continue;
    }
    const removed: number[] = [];
    while (lines[index]?.kind === "remove") removed.push(index++);
    const added: number[] = [];
    while (lines[index]?.kind === "add") added.push(index++);
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
      const before = lines[removed[pair]!]!.text;
      const after = lines[added[pair]!]!.text;
      if (before.length > MAX_WORD_DIFF_CHARS || after.length > MAX_WORD_DIFF_CHARS) continue;
      const changes = wordChanges(before, after);
      if (changes.similarity < MIN_SIMILARITY) continue;
      ranges[removed[pair]!] = changes.removed;
      ranges[added[pair]!] = changes.added;
    }
  }
  return ranges;
}

/** Splits a line's tokens where its changed ranges start and end. */
export function mergeSegments(
  tokens: readonly Token[],
  ranges: readonly [number, number][],
): Segment[] {
  const cuts = [...new Set(ranges.flat())].sort((a, b) => a - b);
  const inRange = (at: number) => ranges.some(([from, to]) => at >= from && at < to);
  const segments: Segment[] = [];
  let at = 0;
  for (const token of tokens) {
    const end = at + token.text.length;
    let from = at;
    for (const cut of [...cuts.filter((cut) => cut > at && cut < end), end]) {
      segments.push({
        text: token.text.slice(from - at, cut - at),
        type: token.type,
        changed: inRange(from),
      });
      from = cut;
    }
    at = end;
  }
  return segments;
}

const cache = new WeakMap<readonly DiffLine[], (Segment[] | null)[]>();

/** Each code line's coloured, change-marked pieces; null for hunk and note lines. Computed once per file, when it's first drawn. */
export function decorateFile(lines: readonly DiffLine[], path: string): (Segment[] | null)[] {
  const cached = cache.get(lines);
  if (cached) return cached;
  const language = languageFor(path);
  const tokens = language ? highlightHunks(lines, language) : lines.map(() => null);
  const ranges = editedRanges(lines);
  const decorated = lines.map((line, index) =>
    code(line)
      ? mergeSegments(tokens[index] ?? [{ text: line.text, type: null }], ranges[index] ?? [])
      : null,
  );
  cache.set(lines, decorated);
  return decorated;
}
