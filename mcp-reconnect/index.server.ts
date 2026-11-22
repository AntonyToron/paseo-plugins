import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  checkChatNow,
  listChats,
  reconnect,
  recordOpen,
  setIgnored,
  signInTerminal,
} from "./server/mcp";
import {
  checkChat,
  ignoreServer,
  listChatMcp,
  openSignInTerminal,
  reconnectChat,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(listChatMcp, listChats);
  server.handle(reconnectChat, reconnect);
  server.handle(checkChat, checkChatNow);
  server.handle(ignoreServer, setIgnored);
  server.handle(openSignInTerminal, signInTerminal);
  const removeHook = server.addHook("agent.open.before", async ({ request }) => {
    recordOpen(request.agentId);
  });
  return () => removeHook();
}
