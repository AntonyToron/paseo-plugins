import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { askChat } from "../shared/contracts";

type Paseo = PluginHandlerContext["paseo"];
type Timeline = PluginLifecycleEvents["agent.turn_ended"]["timeline"];
type Outcome = PluginLifecycleEvents["agent.turn_ended"]["outcome"];

interface PendingQuestion {
  fromAgentId: string;
  toTitle: string;
  question: string;
  /** The turn our question started; the reply is whatever that turn ends with. */
  turnId: string | null;
  started: boolean;
  sentAt: number;
}

// A question whose turn never arrives (the chat was closed, say) stops blocking new ones.
const GIVE_UP_AFTER_MS = 30 * 60_000;

export const questionMessage = (question: string, fromTitle: string) =>
  `${question}\n\n(Asked from the "${fromTitle}" chat. Paseo sends your reply back to it, so answer as if to that chat.)`;

/** The last thing the asked chat said after our question arrived. */
export function replyIn(timeline: Timeline, question: string): string | null {
  let askedAt = -1;
  timeline.forEach((item, index) => {
    if (item.type === "user_message" && item.text.includes(question)) askedAt = index;
  });
  const after = askedAt >= 0 ? timeline.slice(askedAt + 1) : timeline;
  const reply = after.findLast((item) => item.type === "assistant_message");
  return reply?.type === "assistant_message" && reply.text.trim() ? reply.text.trim() : null;
}

export function relayMessage(toTitle: string, outcome: Outcome, reply: string | null): string {
  if (outcome.kind === "completed" && reply) return `The "${toTitle}" chat replied:\n\n${reply}`;
  const why = outcome.kind === "failed" ? `it failed: ${outcome.error.message}` : outcome.kind === "canceled" ? "it was stopped" : "it didn't say anything";
  return `The "${toTitle}" chat didn't answer the question you sent it, because ${why}.`;
}

/** Questions in flight, by the chat they were sent to. One at a time per chat. */
export class Relay {
  private pending = new Map<string, PendingQuestion>();

  async ask({ fromAgentId, fromTitle, toAgentId, toTitle, question }: RpcInput<typeof askChat>, paseo: Paseo) {
    if (fromAgentId === toAgentId) throw new Error("Pick a different chat to ask.");
    const earlier = this.pending.get(toAgentId);
    if (earlier && Date.now() - earlier.sentAt < GIVE_UP_AFTER_MS) {
      throw new Error(`"${toTitle}" is still answering an earlier question.`);
    }
    const target = paseo.agents.ref(toAgentId);
    await target.refresh();
    // A message to a busy chat can join its current turn, and then there's no reply to relay.
    if (target.status === "running") throw new Error(`"${toTitle}" is working right now. Ask it once it's idle.`);
    this.pending.set(toAgentId, { fromAgentId, toTitle, question, turnId: null, started: false, sentAt: Date.now() });
    try {
      await target.send(questionMessage(question, fromTitle));
    } catch (error) {
      this.pending.delete(toAgentId);
      throw error;
    }
    return { ok: true as const };
  }

  onTurnStarted(agentId: string, turnId: string | null) {
    const pending = this.pending.get(agentId);
    if (!pending || pending.started) return;
    pending.started = true;
    pending.turnId = turnId;
  }

  async onTurnEnded(event: PluginLifecycleEvents["agent.turn_ended"], paseo: Paseo) {
    const pending = this.pending.get(event.agent.id);
    if (!pending?.started || (pending.turnId && event.turnId && pending.turnId !== event.turnId)) return;
    this.pending.delete(event.agent.id);
    const message = relayMessage(pending.toTitle, event.outcome, replyIn(event.timeline, pending.question));
    await paseo.agents.ref(pending.fromAgentId).send(message);
  }
}
