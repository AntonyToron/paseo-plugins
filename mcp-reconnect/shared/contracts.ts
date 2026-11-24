import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const mcpServerStatus = z.object({
  name: z.string(),
  state: z.enum(["connected", "needs-auth", "failed", "pending"]),
  detail: z.string().nullable(),
});

export const chatMcp = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  provider: z.enum(["claude", "codex"]),
  /**
   * Claude: "turn" is what it recorded at the chat's last change, "check" a live `claude mcp list`.
   * Codex: both come from the chat's session log; a check also re-reads which servers need a sign-in.
   */
  source: z.enum(["turn", "check"]),
  at: z.string(),
  /** A Claude turn record lists only servers with problems; the rest list every server. */
  servers: z.array(mcpServerStatus),
  /** ChatGPT apps a Codex chat can use. */
  apps: z.array(z.string()),
});
export type ChatMcp = z.infer<typeof chatMcp>;

const agentRef = z.object({ agentId: z.string().min(1) });

/** The latest known MCP state of every open Claude chat, and the servers you've chosen to ignore. */
export const listChatMcp = defineRpc({
  name: "mcp.chats",
  input: z.object({}),
  output: z.object({ chats: z.array(chatMcp), ignored: z.array(z.string()) }),
});

/** Restarts the chat's process, waits for it to reopen, then checks every server. */
export const reconnectChat = defineRpc({
  name: "mcp.reconnect",
  input: agentRef,
  output: z.object({ reopened: z.boolean(), chat: chatMcp }),
});

/** Checks every server as the chat's process would see it, without restarting anything. */
export const checkChat = defineRpc({
  name: "mcp.check",
  input: agentRef,
  output: z.object({ chat: chatMcp }),
});

export const ignoreServer = defineRpc({
  name: "mcp.ignore",
  input: z.object({ name: z.string().min(1), ignored: z.boolean() }),
  output: z.object({ ignored: z.array(z.string()) }),
});

/**
 * Opens a terminal in the chat's workspace to sign in: `claude`, where `/mcp` signs servers in, or
 * `codex mcp login <server>` for a Codex chat.
 */
export const openSignInTerminal = defineRpc({
  name: "mcp.sign-in",
  input: agentRef.extend({ server: z.string().min(1).optional() }),
  output: z.object({ ok: z.literal(true) }),
});
