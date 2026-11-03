import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reloadAgent } from "./server/reload";
import { reloadAgentRpc } from "./shared/reload";

export default function contribute(server: PluginServerContext) {
  server.handle(reloadAgentRpc, reloadAgent);
  return () => {};
}
