import type { ChatMcp } from "../shared/contracts";

/** What the plugin is doing for a chat right now, or just did, beyond its recorded MCP state. */
export type Activity =
  | { kind: "reconnecting" }
  | { kind: "checking" }
  | { kind: "done"; at: number; reopened: boolean | null }
  | { kind: "error"; at: number; message: string };

export interface ChatView {
  chat: ChatMcp | null;
  activity: Activity | null;
}

const chats = new Map<string, ChatMcp>();
const activities = new Map<string, Activity>();
let ignored: ReadonlySet<string> = new Set();
const views = new Map<string, ChatView>();
const listeners = new Set<() => void>();

const notify = () => {
  views.clear();
  for (const listener of listeners) listener();
};

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A stable object per chat between changes, as useSyncExternalStore needs. */
export function view(agentId: string): ChatView {
  let cached = views.get(agentId);
  if (!cached) {
    cached = { chat: chats.get(agentId) ?? null, activity: activities.get(agentId) ?? null };
    views.set(agentId, cached);
  }
  return cached;
}

export const ignoredServers = () => ignored;

export function setChats(next: readonly ChatMcp[], nextIgnored: readonly string[]) {
  chats.clear();
  for (const chat of next) chats.set(chat.agentId, chat);
  ignored = new Set(nextIgnored);
  notify();
}

export function setChat(chat: ChatMcp) {
  chats.set(chat.agentId, chat);
  notify();
}

export function setIgnored(next: readonly string[]) {
  ignored = new Set(next);
  notify();
}

export function setActivity(agentId: string, activity: Activity | null) {
  if (activity) activities.set(agentId, activity);
  else activities.delete(agentId);
  notify();
}

export const activityOf = (agentId: string) => activities.get(agentId) ?? null;
export const chatOf = (agentId: string) => chats.get(agentId) ?? null;
export const allAgentIds = () => new Set([...chats.keys(), ...activities.keys()]);
