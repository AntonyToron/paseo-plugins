import type {
  PluginAgentCommandContext,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { actions, McpPopover } from "./client/popover";
import {
  activityOf,
  allAgentIds,
  chatOf,
  ignoredServers,
  setActivity,
  setChat,
  setChats,
  setIgnored,
} from "./client/store";
import { pillText, RESULT_SHOWN_MS, type PillText } from "./client/summary";
import { checkChat, ignoreServer, listChatMcp, reconnectChat } from "./shared/contracts";
import { openSignInTerminal } from "./shared/contracts";

const POLL_MS = 10_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A pill on each chat whose MCP servers need you: failed, or waiting for a sign-in, leaving out
 * servers you've chosen to ignore. While /mcp-reconnect or a check runs, and for a while after,
 * the pill shows what it's doing and what came back.
 */
export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, { registration: PluginButtonRegistration; text: PillText }>();
  const workspaces = new Map<string, string>();
  let stopped = false;

  const reconcile = () => {
    const ignored = ignoredServers();
    for (const agentId of allAgentIds()) {
      const chat = chatOf(agentId);
      if (chat) workspaces.set(agentId, chat.workspaceId);
      const workspaceId = workspaces.get(agentId);
      const text = pillText(chat, activityOf(agentId), ignored);
      const existing = pills.get(agentId);
      if (!text || !workspaceId) {
        existing?.registration.remove();
        pills.delete(agentId);
        continue;
      }
      if (existing) {
        if (JSON.stringify(existing.text) !== JSON.stringify(text))
          existing.registration.update(text);
        existing.text = text;
        continue;
      }
      const registration = client.addComposerPill({
        id: "mcp-status",
        workspaceId,
        agentId,
        button: { ...text, behavior: { kind: "popover", Content: McpPopover } },
      });
      pills.set(agentId, { registration, text });
    }
    for (const [agentId, pill] of pills) {
      if (allAgentIds().has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const poll = async () => {
    try {
      const { chats, ignored } = await client.rpc(listChatMcp, {});
      if (stopped) return;
      setChats(chats, ignored);
      // Results expire into the plain recorded state.
      for (const agentId of allAgentIds()) {
        const activity = activityOf(agentId);
        if (
          activity &&
          (activity.kind === "done" || activity.kind === "error") &&
          Date.now() - activity.at > RESULT_SHOWN_MS
        )
          setActivity(agentId, null);
      }
      reconcile();
    } catch (error) {
      console.error("[mcp-reconnect] couldn't read the chats' MCP state", error);
    }
  };

  const run = async (agentId: string, workspaceId: string, kind: "reconnecting" | "checking") => {
    if (activityOf(agentId)?.kind === "reconnecting" || activityOf(agentId)?.kind === "checking")
      return;
    workspaces.set(agentId, workspaceId);
    setActivity(agentId, { kind });
    reconcile();
    try {
      if (kind === "reconnecting") {
        const { reopened, chat } = await client.rpc(reconnectChat, { agentId });
        setChat(chat);
        setActivity(agentId, { kind: "done", at: Date.now(), reopened });
      } else {
        const { chat } = await client.rpc(checkChat, { agentId });
        setChat(chat);
        setActivity(agentId, { kind: "done", at: Date.now(), reopened: null });
      }
    } catch (error) {
      setActivity(agentId, { kind: "error", at: Date.now(), message: errorText(error) });
    }
    reconcile();
  };

  actions.current = {
    reconnect: (agentId, workspaceId) => void run(agentId, workspaceId, "reconnecting"),
    check: (agentId, workspaceId) => void run(agentId, workspaceId, "checking"),
    ignore: (name, ignored) => {
      void client
        .rpc(ignoreServer, { name, ignored })
        .then((result) => {
          setIgnored(result.ignored);
          reconcile();
        })
        .catch((error: unknown) =>
          console.error("[mcp-reconnect] couldn't save the ignore", error),
        );
    },
    signIn: async (agentId, server) => {
      await client.rpc(openSignInTerminal, { agentId, server });
    },
  };

  const removeCommand = client.addSlashCommand({
    name: "mcp-reconnect",
    description:
      "Restart this chat's Claude or Codex process so every MCP server reconnects, then show what came back",
    argumentHint: "",
    context: "agent",
    // The pill above the composer shows progress and the result; the command returns at once.
    onSubmit: ({ agent, workspace }: PluginAgentCommandContext) => {
      if (agent.status === "running")
        throw new Error(
          "The chat is mid-turn, and restarting it would cut the turn off. Wait for it to finish.",
        );
      void run(agent.id, workspace.id, "reconnecting");
    },
  });

  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    removeCommand();
    actions.current = null;
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
