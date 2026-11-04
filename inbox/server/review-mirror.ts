import { execCommand } from "@getpaseo/plugin/server";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_DIFF_BYTES = 2 * 1024 * 1024;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}

const mirrorDir = (repo: string) =>
  join(paseoHome(), "plugin-data", "paseo-inbox", "mirrors", `${repo.replace("/", "__")}.git`);

const git = async (gitDir: string, args: string[], maxBuffer = 16 * 1024 * 1024) =>
  (await execCommand("git", ["--git-dir", gitDir, ...args], { timeout: 120_000, maxBuffer }))
    .stdout;

// One git operation per repo at a time: fetches into the same copy would fight over its refs.
const locks = new Map<string, Promise<unknown>>();
function serialized<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(repo) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  locks.set(repo, next);
  return next;
}

/**
 * The plugin's own copy of each repo, bare and without file contents until a diff needs them,
 * so it never touches your working checkouts and stays small. HTTPS, so git's GitHub CLI
 * credential helper signs it in.
 */
async function ensureMirror(repo: string): Promise<string> {
  const dir = mirrorDir(repo);
  if (existsSync(join(dir, "HEAD"))) return dir;
  await mkdir(join(dir, ".."), { recursive: true });
  await execCommand(
    "git",
    ["clone", "--quiet", "--bare", "--filter=blob:none", `https://github.com/${repo}.git`, dir],
    {
      timeout: 300_000,
    },
  );
  return dir;
}

export interface FetchedPullRequest {
  gitDir: string;
  base: string;
  head: string;
  /** New path to old path, for files the PR renamed. */
  renames: Map<string, string>;
}

const fetched = new Map<string, Promise<FetchedPullRequest>>();

/** Fetches the PR's head and base once per head commit; later calls reuse it. */
export function fetchPullRequest(
  repo: string,
  number: number,
  baseRef: string,
  headSha: string,
): Promise<FetchedPullRequest> {
  const key = `${repo}#${number}@${headSha}`;
  let pending = fetched.get(key);
  if (!pending) {
    pending = serialized(repo, async () => {
      const gitDir = await ensureMirror(repo);
      const head = `refs/review/${number}/head`;
      const base = `refs/review/${number}/base`;
      await git(gitDir, [
        "fetch",
        "--quiet",
        "--filter=blob:none",
        "origin",
        `+refs/pull/${number}/head:${head}`,
        `+refs/heads/${baseRef}:${base}`,
      ]);
      const fetchedHead = (await git(gitDir, ["rev-parse", head])).trim();
      if (fetchedHead !== headSha) {
        throw new Error(
          `GitHub moved ${repo}#${number} while fetching (${fetchedHead.slice(0, 7)} isn't ${headSha.slice(0, 7)}). Refresh and try again.`,
        );
      }
      const renames = new Map<string, string>();
      for (const line of (
        await git(gitDir, ["diff", "--name-status", "-M", `${base}...${head}`])
      ).split("\n")) {
        const [status, from, to] = line.split("\t");
        if (status?.startsWith("R") && from && to) renames.set(to, from);
      }
      return { gitDir, base, head, renames };
    });
    pending.catch(() => fetched.delete(key));
    fetched.set(key, pending);
  }
  return pending;
}

/** Which file a `diff --git` section is about: the new path, or the old one for a deletion. */
export function sectionPath(section: string): string | null {
  const added = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1];
  if (added) return added;
  const removed = /^--- a\/(.+)$/m.exec(section)?.[1];
  if (removed && /^\+\+\+ \/dev\/null$/m.test(section)) return removed;
  // Binary files and pure renames have no ---/+++ lines; their header still names the new path.
  return /^diff --git a\/.+? b\/(.+)$/m.exec(section)?.[1] ?? null;
}

/**
 * Several files' diffs against the merge base, which is what GitHub's Files tab shows, from one
 * git call. A file over the size cap is cut short and flagged rather than dropped.
 */
export async function fileDiffs(
  pr: FetchedPullRequest,
  paths: readonly string[],
): Promise<Record<string, { diff: string; truncated: boolean }>> {
  const withRenames = paths.flatMap((path) => [
    path,
    ...(pr.renames.has(path) ? [pr.renames.get(path) as string] : []),
  ]);
  const output = await git(
    pr.gitDir,
    ["diff", "--no-color", "--no-ext-diff", "-M", `${pr.base}...${pr.head}`, "--", ...withRenames],
    MAX_DIFF_BYTES * 16,
  );
  const result: Record<string, { diff: string; truncated: boolean }> = {};
  for (const section of output.split(/^(?=diff --git )/m)) {
    const path = sectionPath(section);
    if (!path || !paths.includes(path)) continue;
    result[path] =
      section.length > MAX_DIFF_BYTES
        ? { diff: section.slice(0, MAX_DIFF_BYTES), truncated: true }
        : { diff: section, truncated: false };
  }
  return result;
}

export async function repoForCwd(cwd: string): Promise<string> {
  if (!existsSync(cwd)) throw new Error(`The folder ${cwd} doesn't exist.`);
  const { stdout } = await execCommand(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd, timeout: 30_000 },
  );
  return stdout.trim();
}
