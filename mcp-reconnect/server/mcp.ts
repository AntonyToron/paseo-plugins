import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  ChatMcp,
  checkChat,
  ignoreServer,
  openSignInTerminal,
  reconnectChat,
} from "../shared/contracts";
import { parseMcpList, problemsFromTranscriptLine } from "../shared/mcp";

type Paseo = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;
// The MCP record is written near the end of a turn's start, so a first look at a long transcript
// reads only its tail; after that, only what the chat appends.
const FIRST_LOOK_BYTES = 4 * 1024 * 1024;
const MAX_CATCH_UP_BYTES = 32 * 1024 * 1024;
// `claude mcp list` connects to every server; with two dozen that takes about 20 seconds.
const CHECK_TIMEOUT_MS = 90_000;
const REOPEN_WAIT_MS = 30_000;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
const ignoredPath = () => join(paseoHome(), "plugin-data", "mcp-reconnect", "ignored.json");
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

interface TranscriptState {
  path: string;
  offset: number;
  aligned: boolean;
  latest: { at: string; servers: ChatMcp["servers"] } | null;
}

const transcripts = new Map<string, TranscriptState>();
/** Live checks, which are fresher than what the transcript last recorded until it records again. */
const checks = new Map<string, ChatMcp>();
/** When each chat's process last opened, from the session-open hook. */
const opened = new Map<string, number>();

export const recordOpen = (agentId: string) => opened.set(agentId, Date.now());

async function readRange(path: string, start: number, end: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/** The chat's latest recorded MCP problems, reading only what its transcript added since last time. */
async function latestRecorded(agentId: string, path: string): Promise<TranscriptState["latest"]> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const fromEnd = () => Math.max(0, size - FIRST_LOOK_BYTES);
  let state = transcripts.get(agentId);
  if (!state || state.path !== path || size < state.offset) {
    const offset = fromEnd();
    state = { path, offset, aligned: offset === 0, latest: null };
    transcripts.set(agentId, state);
  }
  if (size - state.offset > MAX_CATCH_UP_BYTES) {
    state.offset = fromEnd();
    state.aligned = false;
  }
  if (size === state.offset) return state.latest;
  let text = await readRange(path, state.offset, size);
  let from = state.offset;
  if (!state.aligned) {
    const newline = text.indexOf("\n");
    if (newline < 0) return state.latest;
    from += Buffer.byteLength(text.slice(0, newline + 1));
    text = text.slice(newline + 1);
    state.aligned = true;
  }
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline >= 0) {
    for (const line of text.slice(0, lastNewline).split("\n"))
      state.latest = problemsFromTranscriptLine(line) ?? state.latest;
    from += Buffer.byteLength(text.slice(0, lastNewline + 1));
  }
  state.offset = from;
  return state.latest;
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

async function claudeChats(paseo: Paseo) {
  return (await allPages((cursor) => paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } })))
    .map((entry) => entry.agent)
    .filter(
      (agent) => !agent.archivedAt && agent.provider.startsWith("claude") && agent.workspaceId,
    );
}

async function findChat(paseo: Paseo, agentId: string) {
  const agent = (await claudeChats(paseo)).find((candidate) => candidate.id === agentId);
  if (!agent?.workspaceId) throw new Error("That chat isn't an open Claude chat.");
  return { ...agent, workspaceId: agent.workspaceId };
}

export async function readIgnored(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(ignoredPath(), "utf8")) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function setIgnored({ name, ignored }: RpcInput<typeof ignoreServer>) {
  const current = new Set(await readIgnored());
  if (ignored) current.add(name);
  else current.delete(name);
  const list = [...current].sort();
  await mkdir(dirname(ignoredPath()), { recursive: true });
  await writeFile(`${ignoredPath()}.tmp`, JSON.stringify(list));
  await rename(`${ignoredPath()}.tmp`, ignoredPath());
  return { ignored: list };
}

export async function listChats(_input: unknown, { paseo }: { paseo: Paseo }) {
  const chats: ChatMcp[] = [];
  for (const agent of await claudeChats(paseo)) {
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId || !agent.workspaceId) continue;
    const recorded = await latestRecorded(agent.id, transcriptPath(agent.cwd, sessionId));
    const checked = checks.get(agent.id);
    if (checked && (!recorded || checked.at >= recorded.at)) chats.push(checked);
    else if (recorded)
      chats.push({
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        source: "turn",
        ...recorded,
      });
  }
  return { chats, ignored: await readIgnored() };
}

/** Every server's state as a new Claude process in this folder sees it: same config, same logins. */
async function check(agentId: string, workspaceId: string, cwd: string): Promise<ChatMcp> {
  const { stdout } = await execCommand("claude", ["mcp", "list"], {
    cwd,
    env: process.env,
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const servers = parseMcpList(stdout);
  if (!servers.length)
    throw new Error(`\`claude mcp list\` listed no servers: ${stdout.trim().slice(0, 200)}`);
  const chat: ChatMcp = {
    agentId,
    workspaceId,
    source: "check",
    at: new Date().toISOString(),
    servers,
  };
  checks.set(agentId, chat);
  return chat;
}

export async function checkChatNow(
  { agentId }: RpcInput<typeof checkChat>,
  { paseo }: { paseo: Paseo },
) {
  const agent = await findChat(paseo, agentId);
  return { chat: await check(agent.id, agent.workspaceId, agent.cwd) };
}

export async function reconnect(
  { agentId }: RpcInput<typeof reconnectChat>,
  { paseo }: { paseo: Paseo },
) {
  const agent = await findChat(paseo, agentId);
  if (agent.status === "running")
    throw new Error(
      "The chat is mid-turn, and restarting it would cut the turn off. Wait for it to finish.",
    );
  const requestedAt = Date.now();
  await paseo.agents.ref(agent.id).reload();
  // The session-open hook fires when the new process opens, which is the proof it restarted.
  const deadline = Date.now() + REOPEN_WAIT_MS;
  while ((opened.get(agent.id) ?? 0) < requestedAt && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 250));
  const reopened = (opened.get(agent.id) ?? 0) >= requestedAt;
  return { reopened, chat: await check(agent.id, agent.workspaceId, agent.cwd) };
}

export async function signInTerminal(
  { agentId }: RpcInput<typeof openSignInTerminal>,
  { paseo }: { paseo: Paseo },
) {
  const agent = await findChat(paseo, agentId);
  await paseo.terminals.create({
    workspaceId: agent.workspaceId,
    cwd: agent.cwd,
    name: "MCP sign-in",
    command: "claude",
  });
  return { ok: true as const };
}
