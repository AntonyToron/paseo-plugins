import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Relay } from "./server/relay";
import { askChat } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const relay = new Relay();
  server.handle(askChat, (input, { paseo }) => relay.ask(input, paseo));
  const removers = [
    server.on("agent.turn_started", ({ agent, turnId }) => relay.onTurnStarted(agent.id, turnId)),
    server.on("agent.turn_ended", (event, { paseo }) => relay.onTurnEnded(event, paseo)),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
