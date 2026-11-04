import type { RpcInput } from "@getpaseo/plugin";
import type {
  getFileDiffs,
  getReviewFiles,
  resolvePullRequest,
  setFilesViewed,
} from "../shared/review";
import { markViewed, pullRequestFiles } from "./review-github";
import { readRecent, rememberOpened } from "./review-home";
import { fetchPullRequest, fileDiffs, repoForCwd } from "./review-mirror";

const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

// The list call learns the PR's id and refs; the diff and mark calls reuse them.
const known = new Map<string, Awaited<ReturnType<typeof pullRequestFiles>>>();
const keyOf = (repo: string, number: number) => `${repo}#${number}`;

async function current(repo: string, number: number) {
  return known.get(keyOf(repo, number)) ?? loadFiles(repo, number);
}

async function loadFiles(repo: string, number: number) {
  const pr = await pullRequestFiles(repo, number);
  known.set(keyOf(repo, number), pr);
  // Start fetching in the background so the first diff is ready when it's clicked.
  void fetchPullRequest(repo, number, pr.baseRef, pr.headSha).catch(() => undefined);
  return pr;
}

export async function listReviewFiles({ repo, number }: RpcInput<typeof getReviewFiles>) {
  const pr = await loadFiles(repo, number);
  await rememberOpened({
    repo,
    number,
    title: pr.title,
    author: pr.author,
    state: pr.state,
    updatedAt: pr.updatedAt,
  });
  return { title: pr.title, url: pr.url, author: pr.author, headSha: pr.headSha, files: pr.files };
}

export const recentReviews = async () => ({ recent: await readRecent() });

export async function reviewFileDiffs({ repo, number, paths }: RpcInput<typeof getFileDiffs>) {
  const pr = await current(repo, number);
  return {
    diffs: await fileDiffs(await fetchPullRequest(repo, number, pr.baseRef, pr.headSha), paths),
  };
}

export async function setReviewFilesViewed({
  repo,
  number,
  paths,
  viewed,
}: RpcInput<typeof setFilesViewed>) {
  const pr = await current(repo, number);
  await markViewed(pr.id, paths, viewed);
  return { ok: true as const };
}

export async function resolveReviewTarget({ reference, cwd }: RpcInput<typeof resolvePullRequest>) {
  const url = PR_URL.exec(reference);
  if (url?.[1] && url[2]) return { repo: url[1], number: Number(url[2]) };
  const number = Number(reference.trim().replace(/^#/, ""));
  if (!Number.isInteger(number) || number <= 0)
    throw new Error(`Give a PR URL or number, not "${reference}".`);
  if (!cwd)
    throw new Error(
      "A bare PR number needs a workspace to know the repo. Paste the PR's URL instead.",
    );
  return { repo: await repoForCwd(cwd), number };
}
