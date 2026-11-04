import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  deleteComment,
  getComments,
  getSendTargets,
  PendingComment,
  saveComment,
  SendTarget,
  sendComments,
} from "../shared/comments";
import { dataDir } from "./claude";
import { startChatInRepo } from "./start-review";

type Paseo = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;
const MAX_TARGETS = 20;
const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

const storePath = () => join(dataDir(), "comments.json");
const keyOf = (repo: string, number: number) => `${repo}#${number}`;

let stored: Promise<Record<string, PendingComment[]>> | null = null;
// Writes go one after another, so two quick saves can't interleave and lose one.
let writing: Promise<unknown> = Promise.resolve();

function load() {
  stored ??= readFile(storePath(), "utf8")
    .then((text) => JSON.parse(text) as Record<string, PendingComment[]>)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  return stored;
}

async function update<Result>(
  key: string,
  change: (comments: PendingComment[]) => { comments: PendingComment[]; result: Result },
): Promise<Result> {
  const run = writing.then(async () => {
    const all = await load();
    const { comments, result } = change(all[key] ?? []);
    if (comments.length) all[key] = comments;
    else delete all[key];
    await mkdir(dataDir(), { recursive: true });
    await writeFile(`${storePath()}.tmp`, JSON.stringify(all));
    await rename(`${storePath()}.tmp`, storePath());
    return result;
  });
  writing = run.catch(() => undefined);
  return run;
}

export async function listComments({ repo, number }: RpcInput<typeof getComments>) {
  return { comments: (await load())[keyOf(repo, number)] ?? [] };
}

export function storeComment({ repo, number, id, anchor, body }: RpcInput<typeof saveComment>) {
  return update(keyOf(repo, number), (comments) => {
    const existing = id ? comments.find((comment) => comment.id === id) : undefined;
    const comment: PendingComment = existing
      ? { ...existing, body }
      : { ...anchor, id: randomUUID(), body, createdAt: new Date().toISOString() };
    return {
      comments: existing
        ? comments.map((entry) => (entry.id === comment.id ? comment : entry))
        : [...comments, comment],
      result: { comment },
    };
  });
}

export async function removeComment({ repo, number, id }: RpcInput<typeof deleteComment>) {
  await update(keyOf(repo, number), (comments) => ({
    comments: comments.filter((comment) => comment.id !== id),
    result: null,
  }));
  return { ok: true as const };
}

async function allPages<Item>(
  fetch: (
    cursor: string | undefined,
  ) => Promise<{ entries: Item[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    items.push(...page.entries);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return items;
}

export async function sendTargets(
  { repo, number }: RpcInput<typeof getSendTargets>,
  { paseo }: { paseo: Paseo },
): Promise<{ targets: SendTarget[] }> {
  const [workspaces, agents] = await Promise.all([
    allPages((cursor) => paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } })),
    allPages((cursor) => paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } })),
  ]);
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const names = new RegExp(`#${number}\\b|/pull/${number}\\b`);
  const targets = agents
    .map((entry) => entry.agent)
    .filter((agent) => !agent.archivedAt)
    .map((agent): SendTarget => {
      const workspace = agent.workspaceId ? byId.get(agent.workspaceId) : undefined;
      const branchPr = PR_URL.exec(workspace?.githubRuntime?.pullRequest?.url ?? "");
      const title = agent.title ?? "Untitled chat";
      return {
        agentId: agent.id,
        title,
        workspaceTitle: workspace?.title ?? workspace?.name ?? null,
        lastActivityAt: agent.lastUserMessageAt ?? agent.updatedAt,
        onThisPullRequest:
          (branchPr?.[1] === repo && Number(branchPr[2]) === number) ||
          names.test(`${title} ${workspace?.title ?? ""}`),
      };
    })
    .sort(
      (a, b) =>
        Number(b.onThisPullRequest) - Number(a.onThisPullRequest) ||
        b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  return { targets: targets.slice(0, MAX_TARGETS) };
}

/** The comments as one message: each with its file, line and code, in file and line order. */
export function commentsMessage(input: {
  url: string;
  title: string;
  note: string;
  comments: readonly PendingComment[];
}): string {
  const sorted = [...input.comments].sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line,
  );
  const parts = [
    `My review comments on "${input.title}" (${input.url}), written while reading its diff. They aren't on GitHub.`,
  ];
  if (input.note.trim()) parts.push(input.note.trim());
  sorted.forEach((comment, index) => {
    const where = `${comment.path}, line ${comment.line}${comment.side === "old" ? " (a removed line)" : ""}`;
    const code = comment.lineText.trim() ? `\n> ${comment.lineText.trim()}` : "";
    parts.push(`${index + 1}. ${where}:${code}\n${comment.body.trim()}`);
  });
  return parts.join("\n\n");
}

/** Sends the pending comments to a chat, or a new one, and clears the ones it sent. */
export async function sendPendingComments(
  { repo, number, agentId, note, url, title }: RpcInput<typeof sendComments>,
  { paseo }: { paseo: Paseo },
) {
  const key = keyOf(repo, number);
  const comments = (await load())[key] ?? [];
  if (!comments.length) throw new Error("There are no pending comments to send.");
  const message = commentsMessage({ url, title, note, comments });
  let target = agentId;
  if (target) await paseo.agents.ref(target).send(message);
  else
    target = (
      await startChatInRepo(paseo, {
        repo,
        title: `Review comments on PR #${number} ${title}`,
        prompt: message,
      })
    ).agentId;
  const sent = new Set(comments.map((comment) => comment.id));
  // Comments written while this was sending stay pending.
  await update(key, (current) => ({
    comments: current.filter((comment) => !sent.has(comment.id)),
    result: null,
  }));
  return { agentId: target, sent: sent.size };
}
