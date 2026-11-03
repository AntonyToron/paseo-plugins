import { execCommand } from "@getpaseo/plugin/server";
import { existsSync } from "node:fs";
import type { PullRequestSummary } from "../shared/model";

interface Login {
  login: string;
}
interface PullRequestJson {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  author: Login;
  reviewDecision: string;
  commits: { committedDate: string; authors: Login[] }[];
  comments: { author: Login | null; createdAt: string }[];
  reviews: { author: Login | null; submittedAt: string | null }[];
  /** Null on PRs whose head commit never had checks, e.g. from a fork. */
  statusCheckRollup: { status?: string; conclusion?: string; state?: string }[] | null;
}
interface CacheEntry {
  fetchedAt: number;
  ttlMs: number;
  pending: Promise<PullRequestJson>;
}

const OPEN_TTL_MS = 90_000;
const CLOSED_TTL_MS = 30 * 60_000;
const FIELDS = "number,url,state,isDraft,author,reviewDecision,commits,comments,reviews,statusCheckRollup";
// Bots that comment on every PR; their posts aren't news for a reviewer.
const BOTS = new Set(["github-actions", "coderabbitai", "vercel", "claude", "codecov", "sentry-io", "linear", "cursor"]);

const cache = new Map<string, CacheEntry>();
const repoByCwd = new Map<string, Promise<string>>();
let myLogin: Promise<string> | null = null;

const gh = async (args: string[], cwd?: string) => (await execCommand("gh", args, { cwd, timeout: 30_000 })).stdout.trim();

function me(): Promise<string> {
  myLogin ??= gh(["api", "user", "--jq", ".login"]).catch((error: unknown) => {
    myLogin = null;
    throw error;
  });
  return myLogin;
}

async function repoIn(cwd: string): Promise<string> {
  // Spawning in a missing folder fails as "spawn gh ENOENT", which reads like gh is missing.
  if (!existsSync(cwd)) throw new Error(`The chat's folder no longer exists: ${cwd}`);
  return gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd);
}

export function repoForCwd(cwd: string): Promise<string> {
  let repo = repoByCwd.get(cwd);
  if (!repo) {
    repo = repoIn(cwd);
    repo.catch(() => repoByCwd.delete(cwd));
    repoByCwd.set(cwd, repo);
  }
  return repo;
}

function fetchPullRequest(repo: string, number: number): Promise<PullRequestJson> {
  const key = `${repo}#${number}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < cached.ttlMs) return cached.pending;
  const entry: CacheEntry = {
    fetchedAt: Date.now(),
    ttlMs: OPEN_TTL_MS,
    pending: gh(["pr", "view", String(number), "--repo", repo, "--json", FIELDS]).then(
      (stdout) => JSON.parse(stdout) as PullRequestJson,
    ),
  };
  entry.pending.then(
    (pr) => {
      if (pr.state !== "OPEN") entry.ttlMs = CLOSED_TTL_MS;
    },
    () => cache.delete(key),
  );
  cache.set(key, entry);
  return entry.pending;
}

function checksState(rollup: PullRequestJson["statusCheckRollup"]): PullRequestSummary["checks"] {
  if (!rollup?.length) return "none";
  const failed = rollup.some((check) =>
    ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR"].includes(check.conclusion ?? check.state ?? ""),
  );
  if (failed) return "failed";
  const pending = rollup.some((check) => (check.status && check.status !== "COMPLETED") || check.state === "PENDING");
  return pending ? "pending" : "passed";
}

const isPerson = (login: string | undefined, mine: string) =>
  Boolean(login) && login !== mine && !BOTS.has(login ?? "") && !login?.endsWith("[bot]");

/** `since` is when the chat last finished a turn; with no such turn, nothing counts as new. */
export async function summarizePullRequest(repo: string, number: number, since: string | null): Promise<PullRequestSummary> {
  const [pr, mine] = await Promise.all([fetchPullRequest(repo, number), me()]);
  const after = (iso: string | null | undefined) => Boolean(since && iso && iso > since);
  const decision = pr.reviewDecision;
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    mine: pr.author.login === mine,
    checks: checksState(pr.statusCheckRollup),
    reviewDecision: decision === "APPROVED" || decision === "CHANGES_REQUESTED" || decision === "REVIEW_REQUIRED" ? decision : null,
    newCommits: pr.commits.filter(
      (commit) => after(commit.committedDate) && !commit.authors.some((author) => author.login === mine),
    ).length,
    newComments:
      pr.comments.filter((comment) => after(comment.createdAt) && isPerson(comment.author?.login, mine)).length +
      pr.reviews.filter((review) => after(review.submittedAt) && isPerson(review.author?.login, mine)).length,
  };
}
