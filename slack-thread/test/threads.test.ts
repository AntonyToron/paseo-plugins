import { describe, expect, it } from "vitest";
import { lastPermalink } from "../shared/contracts";
import { typedLink } from "../server/threads";

const url = "https://acme.slack.com/archives/C0123ABCDEF/p1793349625978429";

describe("Slack thread detection", () => {
  it("finds the last permalink, keeping thread query params but not the sentence's full stop", () => {
    expect(lastPermalink(`see ${url} and ${url}?thread_ts=1793349625.978429&cid=C0123ABCDEF.`)).toBe(
      `${url}?thread_ts=1793349625.978429&cid=C0123ABCDEF`,
    );
  });

  it("only counts links you typed", () => {
    expect(typedLink({ type: "user", message: { content: `is this related at all ${url}` } })).toBe(url);
    expect(typedLink({ type: "assistant", message: { content: [{ type: "text", text: url }] } })).toBeNull();
    expect(typedLink({ type: "user", message: { content: `<task-notification>${url}</task-notification>` } })).toBeNull();
  });
});
