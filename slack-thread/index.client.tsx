import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { checkRepliesPrompt, listThreads, type ChatThread } from "./shared/contracts";

const POLL_MS = 15_000;

interface Pill {
  thread: ChatThread;
  registration: PluginButtonRegistration;
}

/**
 * Pills are registered per chat, so this keeps one per chat that has a Slack thread and updates
 * or removes it as the server's list changes.
 */
export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, Pill>();
  let stopped = false;

  const behavior = (thread: ChatThread) => ({
    kind: "menu" as const,
    items: [
      {
        kind: "item" as const,
        id: "open",
        title: "Open in Slack",
        icon: "ExternalLink",
        behavior: { kind: "action" as const, onPress: () => openExternalUrl(thread.url) },
      },
      {
        kind: "item" as const,
        id: "check",
        title: "Check for new replies",
        icon: "RefreshCw",
        behavior: {
          kind: "action" as const,
          onPress: () => client.paseo.agents.ref(thread.agentId).send(checkRepliesPrompt(thread.url)),
        },
      },
    ],
  });

  const reconcile = (threads: readonly ChatThread[]) => {
    const seen = new Set<string>();
    for (const thread of threads) {
      seen.add(thread.agentId);
      const existing = pills.get(thread.agentId);
      if (existing && existing.thread.workspaceId === thread.workspaceId) {
        if (existing.thread.url !== thread.url) existing.registration.update({ behavior: behavior(thread) });
        existing.thread = thread;
        continue;
      }
      existing?.registration.remove();
      const registration = client.addComposerPill({
        id: "slack-thread",
        workspaceId: thread.workspaceId,
        agentId: thread.agentId,
        button: { title: "Slack thread this chat is about", label: "Slack thread", icon: "Hash", behavior: behavior(thread) },
      });
      pills.set(thread.agentId, { thread, registration });
    }
    for (const [agentId, pill] of pills) {
      if (seen.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const poll = async () => {
    try {
      const { threads } = await client.rpc(listThreads, {});
      if (!stopped) reconcile(threads);
    } catch (error) {
      console.error("[slack-thread] couldn't list chat threads", error);
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
