import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatTasks, RunningTask } from "../shared/contracts";
import { applyLine, emptyScan, type StartedTask, type TaskScan } from "../shared/scan";

type Paseo = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;
// Terminal colour codes, which start with the escape character.
// eslint-disable-next-line no-control-regex
const ANSI_CODES = /\x1b\[[0-9;]*[A-Za-z]/g;
// Transcripts can be hundreds of megabytes. A first look reads only the end, where any task still
// running was started; after that, only what each chat appends.
const FIRST_LOOK_BYTES = 4 * 1024 * 1024;
const MAX_CATCH_UP_BYTES = 32 * 1024 * 1024;
const LAST_LINE_BYTES = 2048;
const LAST_LINE_CHARS = 140;

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

interface ChatState {
  path: string;
  offset: number;
  /** False after a jump into the middle of the file, where the first line is a partial one. */
  aligned: boolean;
  scan: TaskScan;
}

const states = new Map<string, ChatState>();

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

/** Brings a chat's scan up to the end of its transcript, reading only what's new. */
async function catchUp(agentId: string, path: string): Promise<TaskScan | null> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const fromEnd = () => Math.max(0, size - FIRST_LOOK_BYTES);
  let state = states.get(agentId);
  // A new transcript, or one that shrank (rewritten): start over from its end.
  if (!state || state.path !== path || size < state.offset) {
    const offset = fromEnd();
    state = { path, offset, aligned: offset === 0, scan: emptyScan() };
    states.set(agentId, state);
  }
  if (size - state.offset > MAX_CATCH_UP_BYTES) {
    state.offset = fromEnd();
    state.aligned = false;
  }
  if (size === state.offset) return state.scan;
  let text = await readRange(path, state.offset, size);
  let from = state.offset;
  if (!state.aligned) {
    const newline = text.indexOf("\n");
    if (newline < 0) return state.scan;
    from += Buffer.byteLength(text.slice(0, newline + 1));
    text = text.slice(newline + 1);
    state.aligned = true;
  }
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    state.offset = from;
    return state.scan;
  }
  for (const line of text.slice(0, lastNewline).split("\n")) applyLine(state.scan, line);
  state.offset = from + Buffer.byteLength(text.slice(0, lastNewline + 1));
  return state.scan;
}

/** The output files some process still has open: their shell tasks are running. */
async function openFiles(paths: readonly string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  let stdout: string;
  try {
    ({ stdout } = await execCommand("lsof", ["-F", "n", "--", ...paths], { timeout: 10_000 }));
  } catch (error) {
    // lsof exits 1 when none of the files is open, which is an answer, not a failure.
    const failed = error as { code?: number; stdout?: string };
    if (failed.code !== 1) throw error;
    stdout = failed.stdout ?? "";
  }
  return new Set(
    stdout
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1)),
  );
}

let daemonStart: Promise<number> | null = null;
/** Background agents die with the daemon; one started before it is gone. */
function daemonStartedAt(): Promise<number> {
  daemonStart ??= execCommand("ps", ["-o", "lstart=", "-p", String(process.ppid)]).then(
    ({ stdout }) => {
      const startedAt = Date.parse(stdout.trim());
      if (Number.isNaN(startedAt))
        throw new Error(`Couldn't read the daemon's start time from ps: "${stdout.trim()}"`);
      return startedAt;
    },
  );
  return daemonStart;
}

async function lastLine(path: string): Promise<string | null> {
  try {
    const { size } = await stat(path);
    const tail = await readRange(path, Math.max(0, size - LAST_LINE_BYTES), size);
    // Progress bars redraw with carriage returns; the latest redraw is what's on screen.
    const line = tail
      .split(/[\r\n]+/)
      .map((part) => part.replace(ANSI_CODES, "").trim())
      .filter(Boolean)
      .at(-1);
    return line ? line.slice(0, LAST_LINE_CHARS) : null;
  } catch {
    return null;
  }
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

export async function listChatTasks(
  _input: unknown,
  { paseo }: { paseo: Paseo },
): Promise<{ chats: ChatTasks[] }> {
  const agents = (
    await allPages((cursor) => paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } }))
  )
    .map((entry) => entry.agent)
    .filter((agent) => !agent.archivedAt && agent.provider.startsWith("claude"));
  const live = new Set(agents.map((agent) => agent.id));
  for (const id of states.keys()) if (!live.has(id)) states.delete(id);

  const candidates: { agentId: string; workspaceId: string; tasks: StartedTask[] }[] = [];
  for (const agent of agents) {
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId || !agent.workspaceId || agent.status === "closed") continue;
    const scan = await catchUp(agent.id, transcriptPath(agent.cwd, sessionId));
    const tasks = scan ? Object.values(scan.started) : [];
    if (tasks.length) candidates.push({ agentId: agent.id, workspaceId: agent.workspaceId, tasks });
  }

  const [open, startedAt] = await Promise.all([
    openFiles(candidates.flatMap((chat) => chat.tasks.flatMap((task) => task.outputFile ?? []))),
    daemonStartedAt(),
  ]);
  const running = (task: StartedTask) =>
    task.kind === "shell"
      ? task.outputFile !== null && open.has(task.outputFile)
      : Date.parse(task.startedAt) >= startedAt;

  const chats: ChatTasks[] = [];
  for (const chat of candidates) {
    const tasks: RunningTask[] = await Promise.all(
      chat.tasks.filter(running).map(async (task) => ({
        id: task.id,
        kind: task.kind,
        description: task.description,
        startedAt: task.startedAt,
        lastLine: task.outputFile ? await lastLine(task.outputFile) : null,
      })),
    );
    if (tasks.length) chats.push({ agentId: chat.agentId, workspaceId: chat.workspaceId, tasks });
  }
  return { chats };
}
