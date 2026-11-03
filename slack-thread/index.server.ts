import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listChatThreads } from "./server/threads";
import { listThreads } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listThreads, listChatThreads);
  return () => {};
}
