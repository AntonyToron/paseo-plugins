import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { transcriptPath, updateEntry, type ChatEntry } from "../server/chat-index";
import { search } from "../server/search";

const line = (record: object) => `${JSON.stringify(record)}\n`;
const you = (text: string, at: string) => line({ type: "user", timestamp: at, message: { content: text } });
const claude = (text: string, at: string) =>
  line({ type: "assistant", timestamp: at, message: { content: [{ type: "text", text }] } });

describe("updateEntry", () => {
  const agent = { agentId: "a1", sessionId: "s1", cwd: "/work/repo", title: "Webhook retries", archived: false };
  let path: string;

  beforeAll(async () => {
    process.env.CLAUDE_CONFIG_DIR = await mkdtemp(join(tmpdir(), "chat-search-"));
    path = transcriptPath(agent.cwd, agent.sessionId);
    await mkdir(join(path, ".."), { recursive: true });
  });

  it("indexes your messages and Claude's replies, skipping tool output and notifications", async () => {
    await writeFile(
      path,
      you("why do webhook retries fire twice", "2026-11-01T10:00:00Z") +
        line({ type: "user", timestamp: "2026-11-01T10:01:00Z", message: { content: [{ type: "tool_result", content: "tool output" }] } }) +
        you("<task-notification>done</task-notification>", "2026-11-01T10:02:00Z") +
        claude("The retry timer starts before the first attempt finishes.", "2026-11-01T10:03:00Z"),
    );
    const entry = await updateEntry(agent, undefined);
    expect(entry?.messages.map((message) => message.text)).toEqual([
      "why do webhook retries fire twice",
      "The retry timer starts before the first attempt finishes.",
    ]);
  });

  it("leaves a half-written last line for the next read instead of skipping it", async () => {
    const first = (await updateEntry(agent, undefined)) as ChatEntry;
    const partial = claude("Fixed both.", "2026-11-01T11:00:00Z");
    await appendFile(path, partial.slice(0, 20));
    const midWrite = (await updateEntry(agent, first)) as ChatEntry;
    expect(midWrite.messages).toHaveLength(2);
    await appendFile(path, partial.slice(20));
    const finished = (await updateEntry(agent, midWrite)) as ChatEntry;
    expect(finished.messages.at(-1)?.text).toBe("Fixed both.");
  });
});

describe("search", () => {
  const entry = (agentId: string, title: string, texts: [string, boolean][]): ChatEntry => ({
    version: 2,
    agentId,
    sessionId: agentId,
    title,
    archived: false,
    offset: 0,
    messages: texts.map(([text, fromYou], index) => ({ text, fromYou, at: `2026-11-0${index + 1}T00:00:00Z` })),
  });

  it("needs every word somewhere in the chat, title included", () => {
    const chats = [
      entry("retries", "Webhook retries", [["check the backoff settings", true]]),
      entry("other", "Billing", [["backoff for invoice emails", true]]),
    ];
    expect(search(chats, "webhook backoff").map((result) => result.agentId)).toEqual(["retries"]);
  });

  it("ranks one message with the phrase above many with a single common word", () => {
    const chats = [
      entry("common", "A", [
        ...Array.from({ length: 30 }, (_, index): [string, boolean] => [`token ${index}`, true]),
        ["unsubscribe flow", true],
        ["unsubscribe and token in one message", true],
      ]),
      entry("phrase", "B", [["Unsubscribe tokens can reach Slack", false]]),
    ];
    expect(search(chats, "unsubscribe token")[0]?.agentId).toBe("phrase");
  });

  it("ranks chats where you said it above ones where only Claude did", () => {
    const chats = [
      entry("claude-said", "A", [["the unsubscribe token leaks", false]]),
      entry("you-said", "B", [["why does the unsubscribe token leak", true]]),
    ];
    expect(search(chats, "unsubscribe token")[0]?.agentId).toBe("you-said");
  });
});
