// Adapted from the agent-pr plugin: the same rules for which PR a chat is working on.

/** `repo` is `owner/name` when the reference names it; otherwise it resolves in the agent's cwd. */
export interface PullRequestRef {
  readonly repo: string | null;
  readonly number: number;
}

interface Located {
  readonly at: number;
  readonly ref: PullRequestRef | null;
}

const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;
const API_PULLS = /\brepos\/([\w.-]+\/[\w.-]+|\{owner\}\/\{repo\})\/pulls\/(\d+)/g;
const GH_PR_COMMAND =
  /\bgh\s+pr\s+(?:view|checks|diff|checkout|merge|ready|edit|comment|review|close|reopen|update-branch)\b([^|;&\n]*)/g;
export const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
const NUMERIC_FLAGS = new Set(["--interval", "-i", "--limit", "-L"]);
const REPO_FLAGS = new Set(["--repo", "-R"]);

function refFrom(match: RegExpMatchArray): PullRequestRef {
  const repo = match[1] && !match[1].startsWith("{") ? match[1] : null;
  return { repo, number: Number(match[2]) };
}

export function lastUrl(text: string): PullRequestRef | null {
  const matches = [...text.matchAll(PR_URL)];
  const last = matches.at(-1);
  return last ? refFrom(last) : null;
}

function parseGhPrArgs(args: string): PullRequestRef | null {
  const tokens = args
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ""));
  let repo: string | null = null;
  let number: number | null = null;
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1] ?? "";
    if (REPO_FLAGS.has(previous)) repo = token;
    else if (token.startsWith("--repo=")) repo = token.slice("--repo=".length);
    if (number === null && /^#?\d+$/.test(token) && !NUMERIC_FLAGS.has(previous)) {
      number = Number(token.replace("#", ""));
    }
  }
  return number === null ? null : { repo, number };
}

export function fromCommand(command: string): PullRequestRef | null {
  const candidates: Located[] = [
    ...[...command.matchAll(GH_PR_COMMAND)].map((match) => ({
      at: match.index ?? 0,
      ref: lastUrl(match[1] ?? "") ?? parseGhPrArgs(match[1] ?? ""),
    })),
    ...[...command.matchAll(PR_URL)].map((match) => ({ at: match.index ?? 0, ref: refFrom(match) })),
    ...[...command.matchAll(API_PULLS)].map((match) => ({ at: match.index ?? 0, ref: refFrom(match) })),
  ];
  let latest: Located | null = null;
  for (const candidate of candidates) {
    if (candidate.ref && (!latest || candidate.at >= latest.at)) latest = candidate;
  }
  return latest?.ref ?? null;
}
