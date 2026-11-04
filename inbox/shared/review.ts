import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FILE_GROUPS = ["source", "config", "tests", "generated"] as const;
export type FileGroup = (typeof FILE_GROUPS)[number];

export const FILE_GROUP_LABELS: Record<FileGroup, string> = {
  source: "Source",
  config: "Config and docs",
  tests: "Tests",
  generated: "Generated and lockfiles",
};

const GENERATED =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$|\.snap$|\.min\.(js|css)$|(^|\/)(dist|build|out|vendor|__generated__|generated)\/|\.generated\./;
const TESTS =
  /(^|\/)(tests?|__tests__|__mocks__|fixtures?|e2e|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/;
const CONFIG =
  /\.(md|mdx|txt|json|ya?ml|toml|ini|lock)$|(^|\/)(\.github|\.vscode|\.changeset)\/|(^|\/)(tsconfig[^/]*|[^/]*\.config\.[cm]?[jt]s|\.[^/]*rc(\.[cm]?[jt]s|\.json)?|Dockerfile|Makefile|LICENSE)$/;

/** Which group a file goes in, from its path alone: instant, and needs no model. */
export function fileGroup(path: string): FileGroup {
  if (GENERATED.test(path)) return "generated";
  if (TESTS.test(path)) return "tests";
  if (CONFIG.test(path)) return "config";
  return "source";
}

export const viewedState = z.enum(["VIEWED", "UNVIEWED", "DISMISSED"]);
export type ViewedState = z.infer<typeof viewedState>;

export const reviewFile = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changeType: z.string(),
  /** GitHub's own Viewed mark. DISMISSED means it changed after you viewed it. */
  viewed: viewedState,
  group: z.enum(FILE_GROUPS),
});
export type ReviewFile = z.infer<typeof reviewFile>;

const prRef = z.object({ repo: z.string(), number: z.number() });

export const getReviewFiles = defineRpc({
  name: "review.files",
  input: prRef,
  output: z.object({
    title: z.string(),
    url: z.string(),
    author: z.string(),
    headSha: z.string(),
    files: z.array(reviewFile),
  }),
});

export const getFileDiffs = defineRpc({
  name: "review.diffs",
  input: prRef.extend({ paths: z.array(z.string()).min(1) }),
  output: z.object({
    diffs: z.record(z.string(), z.object({ diff: z.string(), truncated: z.boolean() })),
  }),
});

export const setFilesViewed = defineRpc({
  name: "review.set-viewed",
  input: prRef.extend({ paths: z.array(z.string()).min(1), viewed: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
});

export const SORT_TIERS = ["core", "supporting", "trivial"] as const;
export type SortTier = (typeof SORT_TIERS)[number];

export const SORT_TIER_LABELS: Record<SortTier, string> = {
  core: "Core",
  supporting: "Supporting",
  trivial: "Trivial",
};

export const sortedFile = z.object({
  path: z.string(),
  tier: z.enum(SORT_TIERS),
  /** What changed, in a few words. */
  summary: z.string(),
});
export type SortedFile = z.infer<typeof sortedFile>;

export const getFileSort = defineRpc({
  name: "review.sort",
  input: prRef,
  output: z.object({
    status: z.enum(["ready", "running", "failed"]),
    /** Source files in reading order; empty until ready. */
    files: z.array(sortedFile),
    error: z.string().nullable(),
  }),
});

export const pullRequestCard = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  author: z.string(),
  state: z.enum(["OPEN", "DRAFT", "MERGED", "CLOSED"]),
  updatedAt: z.string(),
});
export type PullRequestCard = z.infer<typeof pullRequestCard>;

export const getRecentReviews = defineRpc({
  name: "review.recent",
  input: z.object({}),
  output: z.object({ recent: z.array(pullRequestCard) }),
});

export const searchReviewTargets = defineRpc({
  name: "review.search",
  input: z.object({ text: z.string() }),
  output: z.object({ results: z.array(pullRequestCard) }),
});

export const resolvePullRequest = defineRpc({
  name: "review.resolve",
  /** A PR URL, or a bare number resolved against the repo checked out in cwd. */
  input: z.object({ reference: z.string(), cwd: z.string().nullable() }),
  output: prRef,
});

/** GitHub's per-file anchor on the PR's Files tab. */
export async function githubFileUrl(prUrl: string, path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prUrl}/files#diff-${hex}`;
}

export interface DiffLine {
  kind: "add" | "remove" | "context" | "hunk" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Splits `git diff` output into display lines with old and new line numbers. */
export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: "hunk", text: raw, oldLine: null, newLine: null });
    } else if (!inHunk) {
      // The file header (diff --git, index, ---/+++) says nothing a reviewer needs, except binaries.
      if (raw.startsWith("Binary files"))
        lines.push({ kind: "meta", text: "Binary file changed", oldLine: null, newLine: null });
    } else if (raw.startsWith("+")) {
      lines.push({ kind: "add", text: raw.slice(1), oldLine: null, newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "remove", text: raw.slice(1), oldLine: oldLine++, newLine: null });
    } else if (raw.startsWith("\\")) {
      lines.push({ kind: "meta", text: raw.slice(2), oldLine: null, newLine: null });
    } else if (raw.length || lines.length) {
      lines.push({ kind: "context", text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  // git ends its output with a newline, which reads as one empty context line.
  while (lines.at(-1)?.kind === "context" && lines.at(-1)?.text === "") lines.pop();
  return lines;
}
