import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TurnTail {
  /** The last main-conversation record's uuid; it changes as soon as the chat moves on. */
  uuid: string;
  timestamp: string;
  interrupted: boolean;
  lastStep: string;
}

interface TranscriptRecord {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    stop_reason?: string | null;
    content?: string | ReadonlyArray<{ type?: string; name?: string; text?: string }>;
  };
}

// Only the tail matters, and some transcripts run to tens of megabytes.
const TAIL_BYTES = 512 * 1024;
const FINISHED_STOP_REASONS = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"]);
const USER_STOPPED = "[Request interrupted by user";

function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

/** Claude Code names a project's transcript folder after its cwd with every other character dashed. */
export function transcriptPath(cwd: string, sessionId: string): string {
  return join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
}

async function readTail(path: string): Promise<string> {
  const { size } = await stat(path);
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // A tail that starts mid-file starts mid-line.
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    await handle.close();
  }
}

function contentBlocks(record: TranscriptRecord) {
  const content = record.message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content ?? [];
}

export function classifyLastRecord(record: TranscriptRecord): Pick<TurnTail, "interrupted" | "lastStep"> {
  const blocks = contentBlocks(record);
  if (record.type === "assistant") {
    const toolUse = blocks.findLast((block) => block.type === "tool_use");
    if (toolUse) return { interrupted: true, lastStep: `running ${toolUse.name ?? "a tool"}` };
    const stopReason = record.message?.stop_reason;
    if (stopReason && FINISHED_STOP_REASONS.has(stopReason)) return { interrupted: false, lastStep: "finished" };
    return { interrupted: true, lastStep: "writing a reply" };
  }
  if (blocks.some((block) => block.type === "tool_result")) {
    return { interrupted: true, lastStep: "reading a tool result" };
  }
  const text = blocks.map((block) => block.text ?? "").join("");
  if (text.startsWith(USER_STOPPED)) return { interrupted: false, lastStep: "stopped by you" };
  return { interrupted: true, lastStep: "waiting for a reply to your message" };
}

export async function readTurnTail(path: string): Promise<TurnTail | null> {
  let text: string;
  try {
    text = await readTail(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let record: TranscriptRecord;
    try {
      record = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    if ((record.type !== "user" && record.type !== "assistant") || record.isSidechain || record.isMeta) continue;
    if (!record.uuid || !record.timestamp) continue;
    return { uuid: record.uuid, timestamp: record.timestamp, ...classifyLastRecord(record) };
  }
  return null;
}
