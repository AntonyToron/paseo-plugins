import type { RpcInput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PullRequestCard, searchReviewTargets } from "../shared/review";

const FIELDS = "repository,number,title,author,state,isDraft,updatedAt";
const RECENT_LIMIT = 20;
const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;
const REPO_NUMBER = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
const BARE_NUMBER = /^#?(\d+)$/;

interface SearchJson {
  repository: { nameWithOwner: string };
  number: number;
  title: string;
  author: { login: string } | null;
  state: string;
  isDraft: boolean;
  updatedAt: string;
}

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
const recentPath = () => join(paseoHome(), "plugin-data", "paseo-inbox", "recent-reviews.json");

const gh = async (args: string[]) =>
  (await execCommand("gh", args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout;

const toCard = (pr: SearchJson): PullRequestCard => ({
  repo: pr.repository.nameWithOwner,
  number: pr.number,
  title: pr.title,
  author: pr.author?.login ?? "ghost",
  state:
    pr.isDraft && pr.state.toUpperCase() === "OPEN"
      ? "DRAFT"
      : (pr.state.toUpperCase() as PullRequestCard["state"]),
  updatedAt: pr.updatedAt,
});

async function search(args: string[]): Promise<PullRequestCard[]> {
  return (JSON.parse(await gh(["search", "prs", ...args, "--json", FIELDS])) as SearchJson[]).map(
    toCard,
  );
}

export async function myOpenPullRequests(): Promise<PullRequestCard[]> {
  return search(["--author=@me", "--state=open", "--sort=updated", "--limit=50"]);
}

// Searches stay inside the orgs your own PRs and review requests live in, not all of GitHub.
let owners: Promise<string[]> | null = null;
function yourOwners(): Promise<string[]> {
  owners ??= Promise.all([
    search(["--author=@me", "--state=open", "--limit=50"]),
    search(["--review-requested=@me", "--state=open", "--limit=50"]),
  ]).then(([mine, requested]) => [
    ...new Set([...mine, ...requested].map((pr) => pr.repo.split("/")[0] as string)),
  ]);
  owners.catch(() => {
    owners = null;
  });
  return owners;
}

async function yourRepos(): Promise<string[]> {
  const [mine, recent] = await Promise.all([myOpenPullRequests(), readRecent()]);
  return [...new Set([...mine, ...recent].map((pr) => pr.repo))];
}

async function viewCard(repo: string, number: number): Promise<PullRequestCard | null> {
  try {
    const pr = JSON.parse(
      await gh([
        "pr",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "number,title,author,state,isDraft,updatedAt",
      ]),
    ) as Omit<SearchJson, "repository">;
    return toCard({ ...pr, repository: { nameWithOwner: repo } });
  } catch {
    return null;
  }
}

/** Words search titles in your orgs; a link or owner/repo#n opens that PR; a bare number is tried in your repos. */
export async function searchTargets({ text }: RpcInput<typeof searchReviewTargets>) {
  const query = text.trim();
  if (!query) return { results: [] };
  const url = PR_URL.exec(query) ?? REPO_NUMBER.exec(query);
  if (url?.[1] && url[2]) {
    const card = await viewCard(url[1], Number(url[2]));
    return { results: card ? [card] : [] };
  }
  const bare = BARE_NUMBER.exec(query);
  if (bare?.[1]) {
    const cards = await Promise.all(
      (await yourRepos()).map((repo) => viewCard(repo, Number(bare[1]))),
    );
    return { results: cards.filter((card): card is PullRequestCard => card !== null) };
  }
  const ownerFlags = (await yourOwners()).map((owner) => `--owner=${owner}`);
  return { results: await search([query, ...ownerFlags, "--sort=updated", "--limit=30"]) };
}

export async function readRecent(): Promise<PullRequestCard[]> {
  try {
    return JSON.parse(await readFile(recentPath(), "utf8")) as PullRequestCard[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Remembers a PR you opened for review, newest first. */
export async function rememberOpened(card: PullRequestCard) {
  const recent = (await readRecent()).filter(
    (entry) => entry.repo !== card.repo || entry.number !== card.number,
  );
  const next = [card, ...recent].slice(0, RECENT_LIMIT);
  await mkdir(dirname(recentPath()), { recursive: true });
  await writeFile(`${recentPath()}.tmp`, JSON.stringify(next));
  await rename(`${recentPath()}.tmp`, recentPath());
}
