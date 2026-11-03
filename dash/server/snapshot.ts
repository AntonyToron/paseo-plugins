import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { classify, type DashRow, type PullRequestSummary } from "../shared/model";
import type { PullRequestRef } from "../shared/references";
import { readScans, transcriptPath, updateScan, writeScans, type ChatScan } from "./chat-scan";
import { repoForCwd, summarizePullRequest } from "./github";

type Paseo = PluginHandlerContext["paseo"];
type Agent = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];
type Workspace = Awaited<ReturnType<Paseo["workspaces"]["list"]>>["entries"][number];

const PAGE_LIMIT = 200;
const GH_CONCURRENCY = 6;
const TITLE_PR = /\bPR\s*#?(\d{2,})\b/i;

let scans: Promise<Record<string, ChatScan>> | null = null;

async function allPages<Item>(
  fetch: (cursor: string | undefined) => Promise<{ entries: Item[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }>,
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

async function scanAgents(agents: readonly Agent[]): Promise<Map<string, ChatScan>> {
  scans ??= readScans();
  const stored = await scans;
  const result = new Map<string, ChatScan>();
  let changed = false;
  await Promise.all(
    agents.map(async (agent) => {
      const sessionId = agent.provider === "claude" ? agent.persistence?.sessionId : null;
      if (!sessionId) return;
      const previous = stored[agent.id];
      const next = await updateScan(transcriptPath(agent.cwd, sessionId), sessionId, previous);
      if (!next) return;
      if (next !== previous) {
        stored[agent.id] = next;
        changed = true;
      }
      result.set(agent.id, next);
    }),
  );
  const live = new Set(agents.map((agent) => agent.id));
  for (const id of Object.keys(stored)) {
    if (!live.has(id)) {
      delete stored[id];
      changed = true;
    }
  }
  if (changed) await writeScans(stored);
  return result;
}

interface PullRequestSource {
  ref: PullRequestRef;
  /** Folders to resolve a bare PR number's repo in, in order; worktrees get deleted. */
  cwds: string[];
  agentId: string | null;
  since: string | null;
}

/**
 * Paseo titles a workspace from its first message, so a title naming a PR says what the
 * workspace is for. Otherwise the chats' own PRs come next, since a review workspace on a shared
 * checkout reports the checkout branch's PR, and a worktree's branch PR is the last resort.
 */
function pullRequestSource(workspace: Workspace, agents: readonly Agent[], chatScans: Map<string, ChatScan>): PullRequestSource | null {
  const workspaceDir = workspace.workspaceDirectory ?? workspace.projectRootPath;
  const sightings = agents
    .map((agent) => ({ agent, scan: chatScans.get(agent.id), sighting: chatScans.get(agent.id)?.pullRequest ?? null }))
    .filter((entry) => entry.sighting)
    .sort((a, b) => (b.sighting?.at ?? "").localeCompare(a.sighting?.at ?? ""));
  const fromAgent = (agent: Agent | undefined, ref: PullRequestRef): PullRequestSource => ({
    ref,
    cwds: [agent?.cwd, workspaceDir, workspace.projectRootPath].filter((cwd): cwd is string => Boolean(cwd)),
    agentId: agent?.id ?? null,
    since: agent ? (chatScans.get(agent.id)?.lastFinishedAt ?? null) : null,
  });

  const titled = TITLE_PR.exec(workspace.title ?? "");
  if (titled) {
    const number = Number(titled[1]);
    // A chat that linked the same PR also knows its repo, which a bare title number doesn't.
    const match = sightings.find((entry) => entry.sighting?.ref.number === number);
    return fromAgent(match?.agent ?? sightings[0]?.agent ?? agents[0], match?.sighting?.ref ?? { repo: null, number });
  }
  const latest = sightings[0];
  if (latest?.sighting) return fromAgent(latest.agent, latest.sighting.ref);
  const branchNumber = workspace.githubRuntime?.pullRequest?.number;
  if (workspace.workspaceKind === "worktree" && branchNumber) return fromAgent(agents[0], { repo: null, number: branchNumber });
  return null;
}

async function resolveRepo(source: PullRequestSource): Promise<string> {
  if (source.ref.repo) return source.ref.repo;
  let lastError: unknown = null;
  for (const cwd of new Set(source.cwds)) {
    try {
      return await repoForCwd(cwd);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No folder to look the repo up in");
}

/** Runs `task` over `items` with at most `limit` in flight, so a cold start doesn't spawn 70 gh calls. */
async function mapLimited<Item, Result>(items: readonly Item[], limit: number, task: (item: Item) => Promise<Result>) {
  const results: Result[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as Item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function latestAgentActivity(agents: readonly Agent[]): string | null {
  const times = agents.flatMap((agent) => [agent.updatedAt, agent.lastUserMessageAt]).filter((time): time is string => Boolean(time));
  return times.sort().at(-1) ?? null;
}

function archiveRisks(workspace: Workspace): string[] {
  // Local checkouts share one folder with every other workspace on it; archiving one keeps the files.
  if (workspace.workspaceKind !== "worktree") return [];
  const risks: string[] = [];
  if (workspace.gitRuntime?.isDirty) risks.push("uncommitted changes");
  const ahead = workspace.gitRuntime?.aheadOfOrigin ?? 0;
  if (ahead > 0) risks.push(`${ahead} unpushed commit${ahead === 1 ? "" : "s"}`);
  return risks;
}

async function buildRow(workspace: Workspace, agents: Agent[], chatScans: Map<string, ChatScan>): Promise<DashRow> {
  const source = pullRequestSource(workspace, agents, chatScans);
  let pullRequest: PullRequestSummary | null = null;
  let pullRequestError: string | null = null;
  if (source) {
    try {
      const repo = await resolveRepo(source);
      pullRequest = await summarizePullRequest(repo, source.ref.number, source.since);
    } catch (error) {
      pullRequestError = error instanceof Error ? error.message.split("\n")[0] ?? "Couldn't load the PR" : String(error);
    }
  }
  const { group, detail } = classify(workspace.status, pullRequest);
  return {
    workspaceId: workspace.id,
    agentId: source?.agentId ?? agents[0]?.id ?? null,
    title: workspace.title ?? workspace.name,
    activityAt: workspace.activityAt ?? latestAgentActivity(agents),
    group,
    detail: pullRequestError && source ? `#${source.ref.number} · couldn't load from GitHub` : detail,
    pullRequest,
    pullRequestError,
    archiveRisks: archiveRisks(workspace),
  };
}

export async function getSnapshot(_input: unknown, { paseo }: PluginHandlerContext) {
  const [workspaces, agentEntries] = await Promise.all([
    allPages((cursor) => paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } })),
    allPages((cursor) => paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } })),
  ]);
  const agents = agentEntries.map((entry) => entry.agent).filter((agent) => !agent.archivedAt);
  const chatScans = await scanAgents(agents);
  const byWorkspace = new Map<string, Agent[]>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    byWorkspace.set(agent.workspaceId, [...(byWorkspace.get(agent.workspaceId) ?? []), agent]);
  }
  const rows = await mapLimited(
    workspaces.filter((workspace) => !workspace.archivingAt),
    GH_CONCURRENCY,
    (workspace) => buildRow(workspace, byWorkspace.get(workspace.id) ?? [], chatScans),
  );
  return { rows };
}
