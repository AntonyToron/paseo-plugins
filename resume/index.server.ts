import type { PluginServerContext } from "@getpaseo/plugin/server";
import { continueInterruptedChats, dismissInterruptedChats, listInterruptedChats } from "./server/interrupted";
import { continueChats, dismissChats, listInterrupted } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listInterrupted, listInterruptedChats);
  server.handle(continueChats, continueInterruptedChats);
  server.handle(dismissChats, dismissInterruptedChats);
  return () => {};
}
