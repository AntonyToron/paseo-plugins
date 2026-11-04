import { execCommand } from "@getpaseo/plugin/server";
import { fileGroup, type ReviewFile, type ViewedState } from "../shared/review";

interface PullRequestFiles {
  id: string;
  title: string;
  url: string;
  author: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  state: "OPEN" | "DRAFT" | "MERGED" | "CLOSED";
  updatedAt: string;
  files: ReviewFile[];
}

const FILES = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id title url headRefOid headRefName baseRefName state isDraft updatedAt
      author { login }
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions changeType viewerViewedState }
      }
    }
  }
}`;

interface FilesPage {
  data: {
    repository: {
      pullRequest: {
        id: string;
        title: string;
        url: string;
        headRefOid: string;
        state: "OPEN" | "MERGED" | "CLOSED";
        isDraft: boolean;
        updatedAt: string;
        headRefName: string;
        baseRefName: string;
        author: { login: string } | null;
        files: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            path: string;
            additions: number;
            deletions: number;
            changeType: string;
            viewerViewedState: ViewedState;
          }[];
        };
      } | null;
    };
  };
}

async function graphql<Result>(
  query: string,
  variables: Record<string, string | number>,
): Promise<Result> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const { stdout } = await execCommand("gh", args, {
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout) as Result;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Not an owner/name repo: ${repo}`);
  return { owner, name };
}

/** The PR's changed files with your Viewed marks, every page of them. */
export async function pullRequestFiles(repo: string, number: number): Promise<PullRequestFiles> {
  const { owner, name } = splitRepo(repo);
  const files: ReviewFile[] = [];
  let after: string | null = null;
  let pr: NonNullable<FilesPage["data"]["repository"]["pullRequest"]> | null = null;
  do {
    const page: FilesPage = await graphql<FilesPage>(FILES, {
      owner,
      name,
      number,
      ...(after ? { after } : {}),
    });
    pr = page.data.repository.pullRequest;
    if (!pr) throw new Error(`${repo}#${number} isn't a pull request you can see.`);
    for (const file of pr.files.nodes) {
      files.push({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        changeType: file.changeType,
        viewed: file.viewerViewedState,
        group: fileGroup(file.path),
      });
    }
    after = pr.files.pageInfo.hasNextPage ? pr.files.pageInfo.endCursor : null;
  } while (after);
  return {
    id: pr.id,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? "ghost",
    headSha: pr.headRefOid,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    state: pr.isDraft && pr.state === "OPEN" ? "DRAFT" : pr.state,
    updatedAt: pr.updatedAt,
    files,
  };
}

/** Sets your Viewed mark on GitHub, the same one its Files tab shows. */
export async function markViewed(pullRequestId: string, paths: readonly string[], viewed: boolean) {
  const mutation = viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
  // Batched as aliases: one request marks a whole group.
  const BATCH = 50;
  for (let start = 0; start < paths.length; start += BATCH) {
    const batch = paths.slice(start, start + BATCH);
    const fields = batch
      .map(
        (path, index) =>
          `f${index}: ${mutation}(input: { pullRequestId: ${JSON.stringify(pullRequestId)}, path: ${JSON.stringify(path)} }) { clientMutationId }`,
      )
      .join("\n");
    await graphql(`mutation {\n${fields}\n}`, {});
  }
}
