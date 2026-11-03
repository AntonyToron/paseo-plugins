import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { InterruptedChat, continueChats, dismissChats } from "../shared/contracts";
import { daemonStartedAt } from "./daemon-start";
import { readTurnTail, transcriptPath, type TurnTail } from "./transcript";

const RECENT_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 200;
const CONTINUE_MESSAGE = "continue";

type Paseo = PluginHandlerContext["paseo"];
type AgentSnapshot = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];
interface Candidate {
  agent: AgentSnapshot;
  tail: TurnTail;
}

// Mirrors the daemon's own PASEO_HOME resolution, including a literal `~` from a launchd plist.
function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}

const dismissedPath = () => join(paseoHome(), "plugin-data", "paseo-resume", "dismissed.json");

/** Agent id to the transcript record it was dismissed at; any newer record brings it back. */
async function readDismissed(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(dismissedPath(), "utf8")) as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeDismissed(dismissed: Record<string, string>) {
  const path = dismissedPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(dismissed, null, 2));
  await rename(`${path}.tmp`, path);
}

async function listAgents(paseo: Paseo): Promise<AgentSnapshot[]> {
  const agents: AgentSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const result = await paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } });
    agents.push(...result.entries.map((entry) => entry.agent));
    cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return agents;
}

async function findCandidates(paseo: Paseo): Promise<Candidate[]> {
  const now = Date.now();
  const [agents, startedAt] = await Promise.all([listAgents(paseo), daemonStartedAt()]);
  const recent = agents.filter(
    (agent) =>
      agent.provider === "claude" &&
      !agent.archivedAt &&
      agent.status !== "running" &&
      agent.status !== "initializing" &&
      agent.persistence?.sessionId &&
      now - Date.parse(agent.updatedAt) < RECENT_MS,
  );
  const tails = await Promise.all(
    recent.map(async (agent) => ({
      agent,
      tail: await readTurnTail(transcriptPath(agent.cwd, agent.persistence?.sessionId ?? "")),
    })),
  );
  return tails.filter((entry): entry is Candidate => {
    if (!entry.tail?.interrupted) return false;
    const stoppedAt = Date.parse(entry.tail.timestamp);
    // A Claude process that died under a running daemon leaves the agent in error.
    const cutOff = stoppedAt < startedAt || entry.agent.status === "error";
    return cutOff && now - stoppedAt < RECENT_MS;
  });
}

export async function listInterruptedChats(_input: unknown, { paseo }: PluginHandlerContext) {
  const [candidates, dismissed] = await Promise.all([findCandidates(paseo), readDismissed()]);
  const chats: InterruptedChat[] = candidates
    .filter(({ agent, tail }) => dismissed[agent.id] !== tail.uuid)
    .sort((a, b) => b.tail.timestamp.localeCompare(a.tail.timestamp))
    .map(({ agent, tail }) => ({
      agentId: agent.id,
      title: agent.title ?? "Untitled chat",
      cutOffAt: tail.timestamp,
      lastStep: tail.lastStep,
    }));
  return { chats };
}

async function markHandled(paseo: Paseo, agentIds: readonly string[]) {
  const candidates = await findCandidates(paseo);
  const dismissed = await readDismissed();
  const live = new Set(candidates.map(({ agent }) => agent.id));
  for (const id of Object.keys(dismissed)) if (!live.has(id)) delete dismissed[id];
  let count = 0;
  for (const { agent, tail } of candidates) {
    if (!agentIds.includes(agent.id)) continue;
    dismissed[agent.id] = tail.uuid;
    count += 1;
  }
  await writeDismissed(dismissed);
  return count;
}

export async function dismissInterruptedChats(
  { agentIds }: RpcInput<typeof dismissChats>,
  { paseo }: PluginHandlerContext,
) {
  return { dismissed: await markHandled(paseo, agentIds) };
}

export async function continueInterruptedChats(
  { agentIds }: RpcInput<typeof continueChats>,
  { paseo }: PluginHandlerContext,
) {
  const continued: string[] = [];
  const failed: { agentId: string; error: string }[] = [];
  for (const agentId of agentIds) {
    try {
      const handle = paseo.agents.ref(agentId);
      await handle.refresh();
      // The list can be a few seconds old; never talk over a turn that has started since.
      if (handle.status === "running") throw new Error("This chat is already running again");
      await handle.send(CONTINUE_MESSAGE);
      continued.push(agentId);
    } catch (error) {
      failed.push({ agentId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Until the resumed turn writes to its transcript, the chat still looks cut off.
  if (continued.length) await markHandled(paseo, continued);
  return { continued, failed };
}
