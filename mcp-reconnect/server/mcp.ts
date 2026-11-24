import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  codexApps,
  codexServers,
  emptyCodexLog,
  readCodexLine,
  type CodexConfiguredServer,
  type CodexLog,
} from "../shared/codex";
import type {
  ChatMcp,
  checkChat,
  ignoreServer,
  openSignInTerminal,
  reconnectChat,
} from "../shared/contracts";
import { parseMcpList, problemsFromTranscriptLine } from "../shared/mcp";

type Paseo = PluginHandlerContext["paseo"];
type Provider = ChatMcp["provider"];

const PAGE_LIMIT = 200;
// Claude writes its MCP record near the end of a turn's start, so a first look at a long transcript
// reads only its tail; after that, only what the chat appends. Codex writes its full list when the
// thread starts, so its logs are read from the beginning once.
const FIRST_LOOK_BYTES = 4 * 1024 * 1024;
const MAX_CATCH_UP_BYTES = 32 * 1024 * 1024;
// `claude mcp list` connects to every server; with two dozen that takes about 20 seconds.
const CHECK_TIMEOUT_MS = 90_000;
const REOPEN_WAIT_MS = 30_000;
// `codex mcp list` only reads config and saved logins, so it's quick, but runs on every poll.
const CODEX_CONFIG_TTL_MS = 60_000;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
const ignoredPath = () => join(paseoHome(), "plugin-data", "mcp-reconnect", "ignored.json");
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), ".codex");
const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

interface LogCursor {
  path: string;
  offset: number;
  aligned: boolean;
}

const cursors = new Map<string, LogCursor>();
const claudeLatest = new Map<string, { at: string; servers: ChatMcp["servers"] } | null>();
const codexLogs = new Map<string, CodexLog>();
const codexPaths = new Map<string, string>();
const codexConfigs = new Map<string, { at: number; servers: CodexConfiguredServer[] }>();
/** Live Claude checks, which are fresher than its transcript until it records again. */
const checks = new Map<string, ChatMcp>();
/** When each chat's process last opened, from the session-open hook. */
const opened = new Map<string, number>();

export const recordOpen = (agentId: string) => opened.set(agentId, Date.now());

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Passes each complete line a log gained since the last call to `onLine`, after `onReset` when
 * reading starts over. False when the log doesn't exist.
 */
async function readNewLines(
  key: string,
  path: string,
  from: "tail" | "start",
  onReset: () => void,
  onLine: (line: string) => void,
): Promise<boolean> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const firstOffset = from === "tail" ? Math.max(0, size - FIRST_LOOK_BYTES) : 0;
  let cursor = cursors.get(key);
  if (!cursor || cursor.path !== path || size < cursor.offset) {
    cursor = { path, offset: firstOffset, aligned: firstOffset === 0 };
    cursors.set(key, cursor);
    onReset();
  } else if (from === "tail" && size - cursor.offset > MAX_CATCH_UP_BYTES) {
    cursor.offset = firstOffset;
    cursor.aligned = false;
  }
  if (size === cursor.offset) return true;
  const buffer = await readRange(path, cursor.offset, size);
  let start = 0;
  if (!cursor.aligned) {
    const newline = buffer.indexOf(0x0a);
    if (newline < 0) return true;
    start = newline + 1;
    cursor.aligned = true;
  }
  const end = buffer.lastIndexOf(0x0a);
  if (end >= start) {
    for (const line of buffer.subarray(start, end).toString("utf8").split("\n")) onLine(line);
    cursor.offset += end + 1;
  } else cursor.offset += start;
  return true;
}

/** The chat's latest recorded MCP problems, from its Claude transcript. */
async function claudeRecorded(agentId: string, path: string) {
  const exists = await readNewLines(
    agentId,
    path,
    "tail",
    () => claudeLatest.set(agentId, null),
    (line) => {
      const found = problemsFromTranscriptLine(line);
      if (found) claudeLatest.set(agentId, found);
    },
  );
  return exists ? (claudeLatest.get(agentId) ?? null) : null;
}

/**
 * Codex keeps a thread's log under sessions/<year>/<month>/<day>/, by the local date it started,
 * and its ids are UUIDv7, which begin with that start time in milliseconds.
 */
async function codexLogPath(sessionId: string): Promise<string | null> {
  const cached = codexPaths.get(sessionId);
  if (cached) return cached;
  const startedMs = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  if (!Number.isFinite(startedMs)) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  // A day either side, in case the clock's zone changed since.
  for (const shift of [0, -1, 1]) {
    const day = new Date(startedMs + shift * 86_400_000);
    const dir = join(
      codexHome(),
      "sessions",
      String(day.getFullYear()),
      pad(day.getMonth() + 1),
      pad(day.getDate()),
    );
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const name = names.find((candidate) => candidate.endsWith(`-${sessionId}.jsonl`));
    if (name) {
      codexPaths.set(sessionId, join(dir, name));
      return join(dir, name);
    }
  }
  return null;
}

async function readCodexLog(agentId: string, sessionId: string): Promise<CodexLog | null> {
  const path = await codexLogPath(sessionId);
  if (!path) return null;
  const exists = await readNewLines(
    agentId,
    path,
    "start",
    () => codexLogs.set(agentId, emptyCodexLog()),
    (line) => {
      const log = codexLogs.get(agentId);
      if (log) readCodexLine(log, line);
    },
  );
  return exists ? (codexLogs.get(agentId) ?? null) : null;
}

/** The servers Codex would start in this folder, and whether each is signed in. */
async function codexConfigured(cwd: string, fresh: boolean): Promise<CodexConfiguredServer[]> {
  const cached = codexConfigs.get(cwd);
  if (!fresh && cached && Date.now() - cached.at < CODEX_CONFIG_TTL_MS) return cached.servers;
  const { stdout } = await execCommand("codex", ["mcp", "list", "--json"], {
    cwd,
    env: process.env,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const servers = JSON.parse(stdout) as CodexConfiguredServer[];
  if (!Array.isArray(servers))
    throw new Error(`\`codex mcp list --json\` didn't list servers: ${stdout.slice(0, 200)}`);
  codexConfigs.set(cwd, { at: Date.now(), servers });
  return servers;
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

const providerOf = (provider: string): Provider | null =>
  provider.startsWith("claude") ? "claude" : provider.startsWith("codex") ? "codex" : null;

async function openChats(paseo: Paseo) {
  const chats = [];
  for (const { agent } of await allPages((cursor) =>
    paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } }),
  )) {
    const provider = providerOf(agent.provider);
    if (!agent.archivedAt && agent.workspaceId && provider)
      chats.push({ ...agent, workspaceId: agent.workspaceId, provider });
  }
  return chats;
}
type Chat = Awaited<ReturnType<typeof openChats>>[number];

async function findChat(paseo: Paseo, agentId: string): Promise<Chat> {
  const agent = (await openChats(paseo)).find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error("That chat isn't an open Claude or Codex chat.");
  return agent;
}

async function codexChat(
  agent: Chat,
  source: ChatMcp["source"],
  fresh: boolean,
): Promise<ChatMcp | null> {
  const sessionId = agent.persistence?.sessionId;
  if (!sessionId) return null;
  const log = await readCodexLog(agent.id, sessionId);
  if (!log) return null;
  const configured = await codexConfigured(agent.cwd, fresh);
  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    provider: "codex",
    source,
    at: log.activeAt ?? log.startedAt ?? new Date().toISOString(),
    servers: codexServers(log, configured, opened.get(agent.id) ?? null),
    apps: codexApps(log),
  };
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
  for (const agent of await openChats(paseo)) {
    if (agent.provider === "codex") {
      const chat = await codexChat(agent, "turn", false);
      if (chat) chats.push(chat);
      continue;
    }
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId) continue;
    const recorded = await claudeRecorded(agent.id, transcriptPath(agent.cwd, sessionId));
    const checked = checks.get(agent.id);
    if (checked && (!recorded || checked.at >= recorded.at)) chats.push(checked);
    else if (recorded)
      chats.push({
        agentId: agent.id,
        workspaceId: agent.workspaceId,
        provider: "claude",
        source: "turn",
        apps: [],
        ...recorded,
      });
  }
  return { chats, ignored: await readIgnored() };
}

/**
 * Claude: every server's state as a new Claude process in this folder sees it, with the same config
 * and logins. Codex can't be asked without starting a thread, so its log is read again, with fresh
 * sign-in states.
 */
async function check(agent: Chat): Promise<ChatMcp> {
  if (agent.provider === "codex") {
    const chat = await codexChat(agent, "check", true);
    if (!chat) throw new Error("Codex hasn't written this chat's session log yet.");
    return chat;
  }
  const { stdout } = await execCommand("claude", ["mcp", "list"], {
    cwd: agent.cwd,
    env: process.env,
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const servers = parseMcpList(stdout);
  if (!servers.length)
    throw new Error(`\`claude mcp list\` listed no servers: ${stdout.trim().slice(0, 200)}`);
  const chat: ChatMcp = {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    provider: "claude",
    source: "check",
    at: new Date().toISOString(),
    servers,
    apps: [],
  };
  checks.set(agent.id, chat);
  return chat;
}

export async function checkChatNow(
  { agentId }: RpcInput<typeof checkChat>,
  { paseo }: { paseo: Paseo },
) {
  return { chat: await check(await findChat(paseo, agentId)) };
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
  return { reopened, chat: await check(agent) };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export async function signInTerminal(
  { agentId, server }: RpcInput<typeof openSignInTerminal>,
  { paseo }: { paseo: Paseo },
) {
  const agent = await findChat(paseo, agentId);
  if (agent.provider === "codex" && !server)
    throw new Error("Pick the server to sign in to; Codex signs in one at a time.");
  await paseo.terminals.create({
    workspaceId: agent.workspaceId,
    cwd: agent.cwd,
    name: "MCP sign-in",
    command:
      agent.provider === "codex" && server ? `codex mcp login ${shellQuote(server)}` : "claude",
  });
  return { ok: true as const };
}
