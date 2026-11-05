import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listChatTasks } from "./server/tasks";
import { listRunningTasks } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listRunningTasks, listChatTasks);
  return () => {};
}
