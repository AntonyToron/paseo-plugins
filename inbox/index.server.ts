import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getSnapshot } from "./server/snapshot";
import { startReviewChat } from "./server/start-review";
import { getInbox, startReview } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(getInbox, () => getSnapshot());
  server.handle(startReview, startReviewChat);
  return () => {};
}
