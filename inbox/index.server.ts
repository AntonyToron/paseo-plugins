import type { PluginServerContext } from "@getpaseo/plugin/server";
import { chatPullRequests } from "./server/chat-prs";
import {
  listComments,
  removeComment,
  sendPendingComments,
  sendTargets,
  storeComment,
} from "./server/comments";
import {
  listReviewFiles,
  recentReviews,
  resolveReviewTarget,
  reviewFileDiffs,
  reviewFileSort,
  setReviewFilesViewed,
} from "./server/review";
import { searchTargets } from "./server/review-home";
import { getSnapshot } from "./server/snapshot";
import { startReviewChat } from "./server/start-review";
import {
  deleteComment,
  getComments,
  getSendTargets,
  saveComment,
  sendComments,
} from "./shared/comments";
import { getInbox, startReview } from "./shared/contracts";
import {
  getChatPullRequests,
  getFileDiffs,
  getFileSort,
  getRecentReviews,
  getReviewFiles,
  resolvePullRequest,
  searchReviewTargets,
  setFilesViewed,
} from "./shared/review";

export default function contribute(server: PluginServerContext) {
  server.handle(getInbox, ({ refresh }) => getSnapshot(refresh === true));
  server.handle(startReview, startReviewChat);
  server.handle(getReviewFiles, listReviewFiles);
  server.handle(getFileDiffs, reviewFileDiffs);
  server.handle(setFilesViewed, setReviewFilesViewed);
  server.handle(resolvePullRequest, resolveReviewTarget);
  server.handle(getRecentReviews, recentReviews);
  server.handle(searchReviewTargets, searchTargets);
  server.handle(getFileSort, reviewFileSort);
  server.handle(getChatPullRequests, chatPullRequests);
  server.handle(getComments, listComments);
  server.handle(saveComment, storeComment);
  server.handle(deleteComment, removeComment);
  server.handle(getSendTargets, sendTargets);
  server.handle(sendComments, sendPendingComments);
  return () => {};
}
