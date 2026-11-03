import type { PluginAgentCommandContext, PluginClientContext } from "@getpaseo/plugin/client";
import { reloadAgentRpc } from "./shared/reload";

const reconnect = async ({ agent, rpc }: PluginAgentCommandContext) => {
  // Reloading interrupts a running turn, and a slash command gives no chance to confirm.
  if (agent.status === "running") {
    throw new Error("The agent is mid-turn. Stop it or wait for it to finish, then run /mcp-reconnect.");
  }
  await rpc(reloadAgentRpc, { agentId: agent.id });
};

export default function contribute(client: PluginClientContext) {
  const remove = client.addSlashCommand({
    name: "mcp-reconnect",
    description: "Restart this agent's process so every MCP server reconnects",
    argumentHint: "",
    context: "agent",
    onSubmit: reconnect,
  });
  return () => void remove();
}
