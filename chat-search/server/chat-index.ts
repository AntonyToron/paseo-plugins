import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

export interface IndexedMessage {
  at: string;
  fromYou: boolean;
  text: string;
}

export interface ChatEntry {
  version: typeof INDEX_VERSION;
  agentId: string;
  sessionId: string;
  title: string;
  archived: boolean;
  /** Byte offset up to which the transcript has been indexed. */
  offset: number;
  messages: IndexedMessage[];
}

interface Block {
  type?: string;
  text?: string;
}
interface TranscriptRecord {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: string | Block[] };
}

const INDEX_VERSION = 2;
const MAX_MESSAGE_CHARS = 4000;
// Paseo and Claude put these in user records; they aren't things you typed.
const NOT_TYPED_BY_YOU = /^\s*<(task-notification|agent-message|command-|local-command|system-reminder)/;
// The PR summary Paseo attaches to your message when you link a PR: searchable, but not yours.
const PASEO_ATTACHMENT = /^GitHub PR #\d+:/;
// Pasted screenshots inline megabytes of base64; drop it before parsing.
const INLINE_DATA = /"data":"[A-Za-z0-9+/=]{1000,}"/g;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
const indexPath = () => join(paseoHome(), "plugin-data", "paseo-chat-search", "index.json");
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
export const transcriptPath = (cwd: string, sessionId: string) =>
  join(claudeHome(), "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);

export function messagesFrom(record: TranscriptRecord): IndexedMessage[] {
  const at = record.timestamp;
  if (record.isSidechain || record.isMeta || !at) return [];
  if (record.type !== "user" && record.type !== "assistant") return [];
  const content = record.message?.content;
  const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
  const texts = blocks.filter((block) => block.type === "text" && block.text?.trim()).map((block) => (block.text ?? "").trim());
  if (record.type === "assistant") {
    const text = texts.join("\n");
    return text ? [{ at, fromYou: false, text: text.slice(0, MAX_MESSAGE_CHARS) }] : [];
  }
  const typed = texts.filter((text) => !NOT_TYPED_BY_YOU.test(text) && !PASEO_ATTACHMENT.test(text));
  const attached = texts.filter((text) => PASEO_ATTACHMENT.test(text));
  return [
    ...(typed.length ? [{ at, fromYou: true, text: typed.join("\n").slice(0, MAX_MESSAGE_CHARS) }] : []),
    ...attached.map((text) => ({ at, fromYou: false, text: text.slice(0, MAX_MESSAGE_CHARS) })),
  ];
}

/** Streams [offset, end of file) and returns the messages in it and where the last full line ended. */
async function readFrom(path: string, offset: number, size: number): Promise<{ messages: IndexedMessage[]; offset: number }> {
  const messages: IndexedMessage[] = [];
  let consumed = offset;
  // Where the most recent unparseable line started. If nothing parses after it, it is a line
  // Claude is still writing and the next read starts there; otherwise it was junk mid-file.
  let unfinishedAt: number | null = null;
  const lines = createInterface({ input: createReadStream(path, { start: offset, end: size - 1 }), crlfDelay: Infinity });
  for await (const line of lines) {
    const start = consumed;
    consumed += Buffer.byteLength(line) + 1;
    if (!line.trim()) continue;
    try {
      messages.push(...messagesFrom(JSON.parse(line.replace(INLINE_DATA, '""')) as TranscriptRecord));
      unfinishedAt = null;
    } catch {
      unfinishedAt = start;
    }
  }
  return { messages, offset: unfinishedAt ?? Math.min(consumed, size) };
}

export interface AgentToIndex {
  agentId: string;
  sessionId: string;
  cwd: string;
  title: string;
  archived: boolean;
}

export async function updateEntry(agent: AgentToIndex, previous: ChatEntry | undefined): Promise<ChatEntry | null> {
  const path = transcriptPath(agent.cwd, agent.sessionId);
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const fresh = !previous || previous.version !== INDEX_VERSION || previous.sessionId !== agent.sessionId || size < previous.offset;
  const base: ChatEntry = fresh
    ? { version: INDEX_VERSION, agentId: agent.agentId, sessionId: agent.sessionId, title: agent.title, archived: agent.archived, offset: 0, messages: [] }
    : { ...previous, title: agent.title, archived: agent.archived };
  if (size === base.offset) return base;
  const { messages, offset } = await readFrom(path, base.offset, size);
  return { ...base, offset, messages: [...base.messages, ...messages] };
}

export async function readIndex(): Promise<Record<string, ChatEntry>> {
  try {
    return JSON.parse(await readFile(indexPath(), "utf8")) as Record<string, ChatEntry>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeIndex(index: Record<string, ChatEntry>) {
  const path = indexPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(index));
  await rename(`${path}.tmp`, path);
}
