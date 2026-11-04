import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PendingComment } from "../shared/comments";

let home: string;
let comments: typeof import("../server/comments");

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "paseo-inbox-comments-"));
  process.env.PASEO_HOME = home;
  comments = await import("../server/comments");
});
afterAll(() => rm(home, { recursive: true, force: true }));

const comment = (path: string, line: number, body: string, side: "new" | "old" = "new") =>
  ({
    id: `${path}:${line}`,
    path,
    side,
    line,
    lineText: `  code at ${line}`,
    body,
    createdAt: "2026-11-04T12:00:00.000Z",
  }) satisfies PendingComment;

describe("commentsMessage", () => {
  it("lists the comments in file and line order, with their code and the note first", () => {
    const message = comments.commentsMessage({
      url: "https://github.com/zite/zitejs/pull/71",
      title: "zitejs/start",
      note: "Please address these.",
      comments: [
        comment("src/b.ts", 3, "Second file."),
        comment("src/a.ts", 40, "Later line."),
        comment("src/a.ts", 7, "Earlier line, on a removed line.", "old"),
      ],
    });
    expect(message).toBe(
      [
        `My review comments on "zitejs/start" (https://github.com/zite/zitejs/pull/71), written while reading its diff. They aren't on GitHub.`,
        "Please address these.",
        "1. src/a.ts, line 7 (a removed line):\n> code at 7\nEarlier line, on a removed line.",
        "2. src/a.ts, line 40:\n> code at 40\nLater line.",
        "3. src/b.ts, line 3:\n> code at 3\nSecond file.",
      ].join("\n\n"),
    );
  });
});

describe("pending comments", () => {
  it("saves, edits and deletes a PR's comments, kept apart from other PRs", async () => {
    const pr = { repo: "zite/zitejs", number: 71 };
    const anchor = { path: "src/a.ts", side: "new" as const, line: 3, lineText: "const a = 1;" };
    const { comment: saved } = await comments.storeComment({
      ...pr,
      id: null,
      anchor,
      body: "First",
    });
    await comments.storeComment({ ...pr, id: saved.id, anchor, body: "Edited" });
    await comments.storeComment({
      repo: "zite/zitejs",
      number: 72,
      id: null,
      anchor,
      body: "Other PR",
    });
    expect((await comments.listComments(pr)).comments.map((entry) => entry.body)).toEqual([
      "Edited",
    ]);
    await comments.removeComment({ ...pr, id: saved.id });
    expect((await comments.listComments(pr)).comments).toEqual([]);
    expect((await comments.listComments({ ...pr, number: 72 })).comments).toHaveLength(1);
  });
});
