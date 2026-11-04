import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { getChatPullRequests, type ChatPullRequest } from "../shared/review";

const POLL_MS = 30_000;

interface Pill {
  chat: ChatPullRequest;
  registration: PluginButtonRegistration;
}

const samePullRequest = (a: ChatPullRequest, b: ChatPullRequest) =>
  a.repo === b.repo && a.number === b.number && a.workspaceId === b.workspaceId;

/**
 * A "Review files" pill beside Paseo's PR pill in every chat whose workspace has a PR. Pills are
 * registered per chat, so this keeps one per chat and moves or drops it as the PRs change.
 */
export function addReviewPills(
  client: PluginClientContext,
  openReview: (repo: string, number: number) => void,
) {
  const pills = new Map<string, Pill>();
  let stopped = false;

  const button = (chat: ChatPullRequest) => ({
    title: `Review ${chat.repo}#${chat.number} file by file`,
    label: `Review #${chat.number}`,
    icon: "FileDiff",
    behavior: { kind: "action" as const, onPress: () => openReview(chat.repo, chat.number) },
  });

  const reconcile = (chats: readonly ChatPullRequest[]) => {
    const seen = new Set<string>();
    for (const chat of chats) {
      seen.add(chat.agentId);
      const existing = pills.get(chat.agentId);
      if (existing && samePullRequest(existing.chat, chat)) continue;
      existing?.registration.remove();
      const registration = client.addComposerPill({
        id: "review-files",
        workspaceId: chat.workspaceId,
        agentId: chat.agentId,
        button: button(chat),
      });
      pills.set(chat.agentId, { chat, registration });
    }
    for (const [agentId, pill] of pills) {
      if (seen.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
    }
  };

  const poll = async () => {
    try {
      const { chats } = await client.rpc(getChatPullRequests, {});
      if (!stopped) reconcile(chats);
    } catch (error) {
      console.error("[paseo-inbox] couldn't list the chats' PRs", error);
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
