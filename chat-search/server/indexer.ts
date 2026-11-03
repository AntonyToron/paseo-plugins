import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readIndex, updateEntry, writeIndex, type AgentToIndex, type ChatEntry } from "./chat-index";

type Paseo = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;
const REFRESH_AFTER_MS = 30_000;
const SAVE_EVERY = 20;

/**
 * Keeps the chat index current. The first pass reads every transcript once, which can take a few
 * minutes; it runs in the background while searches answer from what is indexed so far.
 */
export class Indexer {
  // One shared load: separate loads gave the indexer and searches two different objects.
  private loading: Promise<Record<string, ChatEntry>> | null = null;
  private running: Promise<void> | null = null;
  private lastRefreshAt = 0;
  private progress: { done: number; total: number } | null = null;
  private lastError: string | null = null;

  /** Why the last pass stopped, so the screen can say the results may be incomplete. */
  error() {
    return this.lastError;
  }

  private load() {
    this.loading ??= readIndex();
    return this.loading;
  }

  async entries(): Promise<ChatEntry[]> {
    return Object.values(await this.load());
  }

  /** Null once a pass has finished; a background refresh after that isn't worth reporting. */
  status() {
    return this.progress;
  }

  refresh(paseo: Paseo) {
    if (this.running || Date.now() - this.lastRefreshAt < REFRESH_AFTER_MS) return;
    this.running = this.run(paseo)
      .then(() => {
        this.lastError = null;
      })
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.progress = null;
      })
      .finally(() => {
        this.running = null;
        this.lastRefreshAt = Date.now();
      });
  }

  async flush() {
    await this.running;
  }

  private async run(paseo: Paseo) {
    const index = await this.load();
    // Set before any further await, so the search that started this pass already reports it.
    if (Object.keys(index).length === 0) this.progress = { done: 0, total: 0 };
    const agents = await listAgents(paseo);
    if (this.progress) this.progress = { done: 0, total: agents.length };
    let sinceSave = 0;
    for (const agent of agents) {
      const next = await updateEntry(agent, index[agent.agentId]);
      if (next && next !== index[agent.agentId]) {
        index[agent.agentId] = next;
        sinceSave += 1;
      }
      if (this.progress) this.progress = { ...this.progress, done: this.progress.done + 1 };
      if (sinceSave >= SAVE_EVERY) {
        await writeIndex(index);
        sinceSave = 0;
      }
    }
    const known = new Set(agents.map((agent) => agent.agentId));
    for (const id of Object.keys(index)) if (!known.has(id)) delete index[id];
    await writeIndex(index);
    this.progress = null;
  }
}

async function listAgents(paseo: Paseo): Promise<AgentToIndex[]> {
  const [agents, workspaces] = await Promise.all([
    pages((cursor) => paseo.agents.list({ filter: { includeArchived: true }, page: { limit: PAGE_LIMIT, cursor } })),
    pages((cursor) => paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } })),
  ]);
  // A workspace title ("Review PR #7856 HTML email send") reads better than a chat's first line.
  const workspaceTitles = new Map(workspaces.map((workspace) => [workspace.id, workspace.title]));
  return agents
    .map((entry) => entry.agent)
    .filter((agent) => agent.provider === "claude" && agent.persistence?.sessionId)
    .map((agent) => ({
      agentId: agent.id,
      sessionId: agent.persistence?.sessionId ?? "",
      cwd: agent.cwd,
      title: (agent.workspaceId ? workspaceTitles.get(agent.workspaceId) : null) ?? agent.title ?? "Untitled chat",
      archived: Boolean(agent.archivedAt),
    }));
}

async function pages<Item>(
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
