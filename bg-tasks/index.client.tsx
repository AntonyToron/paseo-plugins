import type {
  PluginButtonContentProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { listRunningTasks, type ChatTasks, type RunningTask } from "./shared/contracts";

const POLL_MS = 5_000;
const LABEL_CHARS = 32;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

interface Pill {
  chat: ChatTasks;
  registration: PluginButtonRegistration;
}

const runningFor = (startedAt: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const label = (tasks: readonly RunningTask[]) => {
  if (tasks.length > 1) return `${tasks.length} background tasks`;
  const only = tasks[0]?.description ?? "Background task";
  return only.length > LABEL_CHARS ? `${only.slice(0, LABEL_CHARS - 1)}…` : only;
};

// The latest tasks per chat. The popover reads them from here rather than from its pill's
// behavior: replacing the behavior on each poll would close a popover you have open.
const tasksByChat = new Map<string, readonly RunningTask[]>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const NO_TASKS: readonly RunningTask[] = [];

function TaskList(props: PluginButtonContentProps) {
  const agentId = props.context === "agent" ? props.agentId : null;
  const tasks = useSyncExternalStore(subscribe, () =>
    agentId ? (tasksByChat.get(agentId) ?? NO_TASKS) : NO_TASKS,
  );
  const { colors } = props.theme;
  if (!tasks.length)
    return (
      <Text style={{ padding: 12, fontSize: 13, color: colors.foregroundMuted }}>
        Nothing is running in the background any more.
      </Text>
    );
  return (
    <View style={{ padding: 12, gap: 12, minWidth: 320, maxWidth: 460 }}>
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: colors.foregroundMuted,
          letterSpacing: 0.3,
        }}
      >
        STILL RUNNING IN THE BACKGROUND
      </Text>
      {tasks.map((task) => (
        <View key={task.id} style={{ flexDirection: "row", gap: 10 }}>
          <Icon
            name={task.kind === "agent" ? "Bot" : "Terminal"}
            size={14}
            color={colors.foregroundMuted}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, color: colors.foreground }} numberOfLines={2}>
                {task.description}
              </Text>
              <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>
                {runningFor(task.startedAt)}
              </Text>
            </View>
            {task.lastLine ? (
              <Text
                style={{ fontSize: 11, fontFamily: MONO, color: colors.foregroundMuted }}
                numberOfLines={1}
              >
                {task.lastLine}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A pill above the composer of every chat with background tasks still running, such as a
 * `yarn install` or a review agent, so you can see the chat isn't done even when it looks idle.
 */
export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, Pill>();
  let stopped = false;

  const presentation = (chat: ChatTasks) => ({
    title: `${chat.tasks.length} background ${chat.tasks.length === 1 ? "task" : "tasks"} still running`,
    label: label(chat.tasks),
  });

  const reconcile = (chats: readonly ChatTasks[]) => {
    const seen = new Set<string>();
    for (const chat of chats) {
      seen.add(chat.agentId);
      tasksByChat.set(chat.agentId, chat.tasks);
      const existing = pills.get(chat.agentId);
      if (existing && existing.chat.workspaceId === chat.workspaceId) {
        // Only the label and tooltip; the popover follows the store.
        if (label(existing.chat.tasks) !== label(chat.tasks))
          existing.registration.update(presentation(chat));
        existing.chat = chat;
        continue;
      }
      existing?.registration.remove();
      const registration = client.addComposerPill({
        id: "bg-tasks",
        workspaceId: chat.workspaceId,
        agentId: chat.agentId,
        button: {
          ...presentation(chat),
          icon: "Hourglass",
          behavior: { kind: "popover", Content: TaskList },
        },
      });
      pills.set(chat.agentId, { chat, registration });
    }
    for (const [agentId, pill] of pills) {
      if (seen.has(agentId)) continue;
      pill.registration.remove();
      pills.delete(agentId);
      tasksByChat.delete(agentId);
    }
    for (const listener of listeners) listener();
  };

  const poll = async () => {
    try {
      const { chats } = await client.rpc(listRunningTasks, {});
      if (!stopped) reconcile(chats);
    } catch (error) {
      console.error("[bg-tasks] couldn't list running background tasks", error);
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
