import type { RpcInput } from "@getpaseo/plugin";
import { execCommand } from "@getpaseo/plugin/server";
import type { reloadAgentRpc } from "../shared/reload";

// Reload closes the Claude process tree, MCP children included, and resumes the same session.
// The plugin API has no reload, so this goes through the CLI the desktop app ships.
export async function reloadAgent({ agentId }: RpcInput<typeof reloadAgentRpc>) {
  const cli = process.env.PASEO_CLI;
  if (!cli) {
    throw new Error("PASEO_CLI is not set in the plugin process, so the Paseo CLI can't be found");
  }
  await execCommand(cli, ["agent", "reload", agentId], { env: process.env, timeout: 120_000 });
  return { agentId };
}
