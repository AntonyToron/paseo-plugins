import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const prRef = z.object({ repo: z.string(), number: z.number() });

/** Where a comment sits: a line on the new side (added or unchanged) or the old side (removed). */
export const commentAnchor = z.object({
  path: z.string(),
  side: z.enum(["new", "old"]),
  line: z.number(),
  /** The line's code when the comment was written, so the chat sees what it's about. */
  lineText: z.string(),
});
export type CommentAnchor = z.infer<typeof commentAnchor>;

export const pendingComment = commentAnchor.extend({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type PendingComment = z.infer<typeof pendingComment>;

export const anchorKey = (anchor: Pick<CommentAnchor, "path" | "side" | "line">) =>
  `${anchor.path}:${anchor.side}:${anchor.line}`;

/** Your notes on a PR, kept in the plugin until you send them to a chat. They never reach GitHub. */
export const getComments = defineRpc({
  name: "review.comments",
  input: prRef,
  output: z.object({ comments: z.array(pendingComment) }),
});

export const saveComment = defineRpc({
  name: "review.comment.save",
  input: prRef.extend({
    id: z.string().nullable(),
    anchor: commentAnchor,
    body: z.string().min(1),
  }),
  output: z.object({ comment: pendingComment }),
});

export const deleteComment = defineRpc({
  name: "review.comment.delete",
  input: prRef.extend({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const sendTarget = z.object({
  agentId: z.string(),
  title: z.string(),
  workspaceTitle: z.string().nullable(),
  lastActivityAt: z.string(),
  /** On this PR: its workspace's branch is the PR's, or its title names it. */
  onThisPullRequest: z.boolean(),
});
export type SendTarget = z.infer<typeof sendTarget>;

/** Chats you could send the comments to, the ones on this PR first, then the most recent. */
export const getSendTargets = defineRpc({
  name: "review.send-targets",
  input: prRef,
  output: z.object({ targets: z.array(sendTarget) }),
});

export const sendComments = defineRpc({
  name: "review.comments.send",
  input: prRef.extend({
    /** A chat to send to; null starts a new one in the repo's Paseo project. */
    agentId: z.string().nullable(),
    note: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  output: z.object({ agentId: z.string(), sent: z.number() }),
});
