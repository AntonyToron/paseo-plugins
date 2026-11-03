import { describe, expect, it } from "vitest";
import { questionMessage, relayMessage, replyIn } from "../server/relay";

describe("replyIn", () => {
  const question = "what is the code word?";

  it("takes the last thing said after the question, not before it", () => {
    const timeline = [
      { type: "assistant_message" as const, text: "Earlier unrelated answer" },
      { type: "user_message" as const, text: questionMessage(question, "Planner") },
      { type: "assistant_message" as const, text: "Let me check." },
      { type: "assistant_message" as const, text: "It's PELICAN." },
    ];
    expect(replyIn(timeline, question)).toBe("It's PELICAN.");
  });

  it("has no reply when nothing was said after the question", () => {
    expect(replyIn([{ type: "user_message", text: questionMessage(question, "Planner") }], question)).toBeNull();
  });
});

describe("relayMessage", () => {
  it("names the chat that answered", () => {
    expect(relayMessage("Reviewer", { kind: "completed" }, "Looks fine.")).toBe('The "Reviewer" chat replied:\n\nLooks fine.');
  });

  it("says why there's no answer", () => {
    expect(relayMessage("Reviewer", { kind: "canceled", reason: "user" }, null)).toContain("it was stopped");
  });
});
