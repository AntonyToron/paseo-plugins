import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ChatPullRequest } from "../shared/review";

type Paseo = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;
const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

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

/**
 * Every open chat whose workspace's branch has a PR, the PR the sidebar shows for it. Paseo's own
 * chat pill can name a different PR the chat worked on, which plugins can't see, so the pill
 * names its number.
 */
export async function chatPullRequests(
  _input: unknown,
  { paseo }: { paseo: Paseo },
): Promise<{ chats: ChatPullRequest[] }> {
  const [workspaces, agents] = await Promise.all([
    allPages((cursor) => paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } })),
    allPages((cursor) => paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } })),
  ]);
  const byWorkspace = new Map<string, { repo: string; number: number }>();
  for (const workspace of workspaces) {
    if (workspace.archivingAt) continue;
    const url = PR_URL.exec(workspace.githubRuntime?.pullRequest?.url ?? "");
    if (url?.[1] && url[2]) byWorkspace.set(workspace.id, { repo: url[1], number: Number(url[2]) });
  }
  const chats: ChatPullRequest[] = [];
  for (const { agent } of agents) {
    if (agent.archivedAt || !agent.workspaceId) continue;
    const pr = byWorkspace.get(agent.workspaceId);
    if (pr) chats.push({ ...pr, agentId: agent.id, workspaceId: agent.workspaceId });
  }
  return { chats };
}
