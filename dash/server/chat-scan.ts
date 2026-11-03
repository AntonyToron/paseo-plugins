import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fromCommand, GH_PR_CREATE, lastUrl, type PullRequestRef } from "../shared/references";
import { pluginDataPath } from "./paseo-home";

interface Sighting {
  ref: PullRequestRef;
  at: string;
}

/** What the dash needs from a chat's transcript: the PR it is on and when Claude last finished. */
export interface ChatScan {
  version: typeof SCAN_VERSION;
  sessionId: string;
  /** Byte offset up to which the transcript has been read. */
  offset: number;
  /**
   * The last PR you linked, the chat created, or the chat changed. Read-only lookups don't count:
   * agents look up neighbouring PRs all the time.
   */
  pullRequest: Sighting | null;
  lastFinishedAt: string | null;
  /** `gh pr create` calls whose output (the new PR's URL) hasn't been read yet. */
  pendingCreates: string[];
}

const SCAN_VERSION = 3;
const GH_PR_CHANGE = /\bgh\s+pr\s+(?:merge|ready|edit|comment|review|close|reopen|update-branch|checkout)\b/;
const MCP_PR_CHANGE = /create_pull_request|pull_request_review_write|add_.*comment|merge_pull_request|update_pull_request/i;

interface Block {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  tool_use_id?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}
interface TranscriptRecord {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { stop_reason?: string | null; content?: string | Block[] };
}

// Transcripts reach hundreds of megabytes (screenshots), so a first look reads only the start,
// where the PR link usually is, and the end, where the latest PR commands and turns are.
const EDGE_BYTES = 2 * 1024 * 1024;
const MAX_CATCH_UP_BYTES = 32 * 1024 * 1024;
const FINISHED = new Set(["end_turn", "stop_sequence", "max_tokens"]);
// Paseo and Claude put these in user records; they quote other chats and list many PRs.
const NOT_TYPED_BY_YOU = /^\s*<(task-notification|agent-message|command-|local-command|system-reminder)/;

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
export const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => blockText((part as Block).text ?? part)).join("\n");
  return "";
}

function fromToolInput(name: string, input: Record<string, unknown>): PullRequestRef | null {
  if (name === "Bash") return fromCommand(String(input.command ?? ""));
  // The GitHub MCP names PRs by owner, repo and number rather than in a command line.
  const number = Number(input.pullNumber ?? input.pull_number);
  if (/pull_request/i.test(name) && Number.isInteger(number) && number > 0 && input.owner && input.repo) {
    return { repo: `${String(input.owner)}/${String(input.repo)}`, number };
  }
  return null;
}

function applyRecord(scan: ChatScan, record: TranscriptRecord) {
  if (record.isSidechain || !record.timestamp) return;
  const content = record.message?.content;
  const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
  const at = record.timestamp;
  const sight = (ref: PullRequestRef | null) => {
    if (ref) scan.pullRequest = { ref, at };
  };
  if (record.type === "user") {
    for (const block of blocks) {
      if (block.type === "tool_result" && block.tool_use_id && scan.pendingCreates.includes(block.tool_use_id)) {
        scan.pendingCreates = scan.pendingCreates.filter((id) => id !== block.tool_use_id);
        sight(lastUrl(blockText(block.content)));
      } else if (block.type === "text" && !record.isMeta && !NOT_TYPED_BY_YOU.test(block.text ?? "")) {
        sight(lastUrl(block.text ?? ""));
      }
    }
  } else if (record.type === "assistant") {
    for (const block of blocks) {
      if (block.type !== "tool_use" || !block.name) continue;
      const input = block.input ?? {};
      const command = block.name === "Bash" ? String(input.command ?? "") : "";
      if (GH_PR_CREATE.test(command) && block.id) {
        scan.pendingCreates.push(block.id);
      } else if (GH_PR_CHANGE.test(command) || (block.name !== "Bash" && MCP_PR_CHANGE.test(block.name))) {
        sight(fromToolInput(block.name, input));
      }
    }
    const stopReason = record.message?.stop_reason;
    if (stopReason && FINISHED.has(stopReason)) scan.lastFinishedAt = record.timestamp;
  }
}

/** Reads [start, end) and applies every complete line; returns where the last complete line ended. */
async function scanRange(path: string, scan: ChatScan, start: number, end: number): Promise<number> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    let consumedFrom = start;
    if (start > 0 && start !== scan.offset) {
      // Jumped into the middle of the file, so the first line is partial.
      const firstNewline = text.indexOf("\n");
      consumedFrom += Buffer.byteLength(text.slice(0, firstNewline + 1));
      text = text.slice(firstNewline + 1);
    }
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return consumedFrom;
    for (const line of text.slice(0, lastNewline).split("\n")) {
      if (!line.trim()) continue;
      try {
        applyRecord(scan, JSON.parse(line) as TranscriptRecord);
      } catch {
        // A line Claude is still writing, or one from a format this plugin doesn't know.
      }
    }
    return consumedFrom + Buffer.byteLength(text.slice(0, lastNewline + 1));
  } finally {
    await handle.close();
  }
}

export async function updateScan(path: string, sessionId: string, previous: ChatScan | undefined): Promise<ChatScan | null> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return previous?.sessionId === sessionId ? previous : null;
    throw error;
  }
  const fresh =
    !previous || previous.version !== SCAN_VERSION || previous.sessionId !== sessionId || size < previous.offset;
  const scan: ChatScan = fresh
    ? { version: SCAN_VERSION, sessionId, offset: 0, pullRequest: null, lastFinishedAt: null, pendingCreates: [] }
    : { ...previous, pendingCreates: [...previous.pendingCreates] };
  if (size === scan.offset) return scan;
  if (fresh && size > EDGE_BYTES * 2) {
    await scanRange(path, scan, 0, EDGE_BYTES);
    scan.offset = await scanRange(path, scan, size - EDGE_BYTES, size);
  } else if (size - scan.offset > MAX_CATCH_UP_BYTES) {
    scan.offset = await scanRange(path, scan, size - EDGE_BYTES, size);
  } else {
    scan.offset = await scanRange(path, scan, scan.offset, size);
  }
  return scan;
}

const scansPath = () => pluginDataPath("scans.json");

export async function readScans(): Promise<Record<string, ChatScan>> {
  try {
    return JSON.parse(await readFile(scansPath(), "utf8")) as Record<string, ChatScan>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeScans(scans: Record<string, ChatScan>) {
  const path = scansPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(scans));
  await rename(`${path}.tmp`, path);
}
