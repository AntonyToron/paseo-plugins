import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  listReviewFiles,
  resolveReviewTarget,
  reviewFileDiffs,
  setReviewFilesViewed,
} from "./server/review";
import { getSnapshot } from "./server/snapshot";
import { startReviewChat } from "./server/start-review";
import { getInbox, startReview } from "./shared/contracts";
import { getFileDiffs, getReviewFiles, resolvePullRequest, setFilesViewed } from "./shared/review";

export default function contribute(server: PluginServerContext) {
  server.handle(getInbox, ({ refresh }) => getSnapshot(refresh === true));
  server.handle(startReview, startReviewChat);
  server.handle(getReviewFiles, listReviewFiles);
  server.handle(getFileDiffs, reviewFileDiffs);
  server.handle(setFilesViewed, setReviewFilesViewed);
  server.handle(resolvePullRequest, resolveReviewTarget);
  return () => {};
}
