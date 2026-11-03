import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getDashSnapshot } from "./shared/contracts";
import { getSnapshot } from "./server/snapshot";

export default function contribute(server: PluginServerContext) {
  server.handle(getDashSnapshot, getSnapshot);
  return () => {};
}
