import { describe, expect, it } from "vitest";
import { classifyLastRecord } from "../server/transcript";

describe("classifyLastRecord", () => {
  it("treats a finished reply as done", () => {
    const record = { type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } };
    expect(classifyLastRecord(record)).toEqual({ interrupted: false, lastStep: "finished" });
  });

  it("flags a tool call that never got its result", () => {
    const record = { type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] } };
    expect(classifyLastRecord(record)).toEqual({ interrupted: true, lastStep: "running Bash" });
  });

  it("flags a tool result the model never answered", () => {
    const record = { type: "user", message: { content: [{ type: "tool_result" }] } };
    expect(classifyLastRecord(record).interrupted).toBe(true);
  });

  it("flags a prompt that never got a reply", () => {
    const record = { type: "user", message: { content: "can you review this?" } };
    expect(classifyLastRecord(record).interrupted).toBe(true);
  });

  it("leaves chats you stopped yourself alone", () => {
    const record = { type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } };
    expect(classifyLastRecord(record).interrupted).toBe(false);
  });
});
