import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { lastPermalink, type ChatThread } from "../shared/contracts";

type Paseo = PluginHandlerContext["paseo"];

interface ThreadScan {
  sessionId: string;
  offset: number;
  url: string | null;
}

interface TranscriptRecord {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: string | { type?: string; text?: string }[] };
}

const PAGE_LIMIT = 200;
// Same approach as the dash: transcripts can be hundreds of megabytes, and the link you start a
// chat from is in its first message, so a first look reads only the start and the end.
const EDGE_BYTES = 2 * 1024 * 1024;
const MAX_CATCH_UP_BYTES = 32 * 1024 * 1024;
const NOT_TYPED_BY_YOU = /^\s*<(task-notification|agent-message|command-|local-command|system-reminder)/;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
const scansPath = () => join(paseoHome(), "plugin-data", "paseo-slack-thread", "scans.json");
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

export function typedLink(record: TranscriptRecord): string | null {
  if (record.type !== "user" || record.isSidechain || record.isMeta) return null;
  const content = record.message?.content;
  const texts = typeof content === "string" ? [content] : (content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
  return texts.filter((text) => !NOT_TYPED_BY_YOU.test(text)).map(lastPermalink).filter(Boolean).at(-1) ?? null;
}

async function scanRange(path: string, scan: ThreadScan, start: number, end: number, midFile: boolean): Promise<number> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    let from = start;
    if (midFile) {
      const newline = text.indexOf("\n");
      from += Buffer.byteLength(text.slice(0, newline + 1));
      text = text.slice(newline + 1);
    }
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return from;
    for (const line of text.slice(0, lastNewline).split("\n")) {
      // Cheap filter first: most lines are tool output, and only typed messages hold the link.
      if (!line.includes("slack.com/archives")) continue;
      try {
        scan.url = typedLink(JSON.parse(line) as TranscriptRecord) ?? scan.url;
      } catch {
        // A line from a format this plugin doesn't know.
      }
    }
    return from + Buffer.byteLength(text.slice(0, lastNewline + 1));
  } finally {
    await handle.close();
  }
}

async function updateScan(path: string, sessionId: string, previous: ThreadScan | undefined): Promise<ThreadScan | null> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const fresh = !previous || previous.sessionId !== sessionId || size < previous.offset;
  const scan: ThreadScan = fresh ? { sessionId, offset: 0, url: null } : { ...previous };
  if (size === scan.offset) return scan;
  if (fresh && size > EDGE_BYTES * 2) {
    await scanRange(path, scan, 0, EDGE_BYTES, false);
    scan.offset = await scanRange(path, scan, size - EDGE_BYTES, size, true);
  } else if (size - scan.offset > MAX_CATCH_UP_BYTES) {
    scan.offset = await scanRange(path, scan, size - EDGE_BYTES, size, true);
  } else {
    scan.offset = await scanRange(path, scan, scan.offset, size, false);
  }
  return scan;
}

let stored: Promise<Record<string, ThreadScan>> | null = null;

async function readScans(): Promise<Record<string, ThreadScan>> {
  try {
    return JSON.parse(await readFile(scansPath(), "utf8")) as Record<string, ThreadScan>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeScans(scans: Record<string, ThreadScan>) {
  const path = scansPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(scans));
  await rename(`${path}.tmp`, path);
}

export async function listChatThreads(_input: unknown, { paseo }: PluginHandlerContext): Promise<{ threads: ChatThread[] }> {
  stored ??= readScans();
  const scans = await stored;
  const agents = await listAgents(paseo);
  let changed = false;
  const threads: ChatThread[] = [];
  for (const agent of agents) {
    const sessionId = agent.provider === "claude" ? agent.persistence?.sessionId : null;
    if (!sessionId || !agent.workspaceId) continue;
    const next = await updateScan(transcriptPath(agent.cwd, sessionId), sessionId, scans[agent.id]);
    if (!next) continue;
    if (next.offset !== scans[agent.id]?.offset || next.url !== scans[agent.id]?.url) {
      scans[agent.id] = next;
      changed = true;
    }
    if (next.url) threads.push({ agentId: agent.id, workspaceId: agent.workspaceId, url: next.url });
  }
  const live = new Set(agents.map((agent) => agent.id));
  for (const id of Object.keys(scans)) {
    if (!live.has(id)) {
      delete scans[id];
      changed = true;
    }
  }
  if (changed) await writeScans(scans);
  return { threads };
}

async function listAgents(paseo: Paseo) {
  const agents: Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"][] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ page: { limit: PAGE_LIMIT, cursor } });
    agents.push(...page.entries.map((entry) => entry.agent).filter((agent) => !agent.archivedAt));
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return agents;
}
