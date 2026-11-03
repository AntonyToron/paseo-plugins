import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginPopoverProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { continueChats, dismissChats, listInterrupted, type InterruptedChat } from "../shared/contracts";

const interruptedKeys = { all: ["paseo-resume", "interrupted"] as const };
const REFRESH_MS = 30_000;

function useInterruptedChats() {
  const list = useRpc(listInterrupted);
  return useQuery({
    queryKey: interruptedKeys.all,
    queryFn: () => list({}),
    refetchInterval: REFRESH_MS,
    select: (result) => result.chats,
  });
}

function useResumeActions() {
  const queryClient = useQueryClient();
  const resume = useRpc(continueChats);
  const dismiss = useRpc(dismissChats);
  const refresh = () => queryClient.invalidateQueries({ queryKey: interruptedKeys.all });
  return {
    continueAll: useMutation({ mutationFn: (agentIds: string[]) => resume({ agentIds }), onSettled: refresh }),
    skip: useMutation({ mutationFn: (agentIds: string[]) => dismiss({ agentIds }), onSettled: refresh }),
  };
}

const plural = (count: number) => (count === 1 ? "chat" : "chats");

export function ResumeSidebarRow(props: PluginSidebarItemProps) {
  const { data: chats } = useInterruptedChats();
  if (!chats?.length) return null;
  return (
    <SidebarRow
      icon="RotateCcw"
      label={`Resume ${chats.length} interrupted ${plural(chats.length)}`}
      onPress={() => props.openPopover(ResumePopover)}
    />
  );
}

function useStyles({ colors }: PluginTheme) {
  return useMemo(
    () => ({
      root: { width: 360, maxHeight: 460, padding: 12, gap: 10 },
      heading: { fontSize: 14, fontWeight: "600" as const, color: colors.foreground },
      note: { fontSize: 12, color: colors.foregroundMuted },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 6 },
      rowText: { flex: 1, gap: 2 },
      title: { fontSize: 13, color: colors.foreground },
      meta: { fontSize: 11, color: colors.foregroundMuted },
      actions: { flexDirection: "row" as const, gap: 8, marginTop: 4 },
      primary: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent },
      primaryText: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
      secondary: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.surface2 },
      secondaryText: { fontSize: 12, color: colors.foreground },
      error: { fontSize: 12, color: colors.statusDanger },
    }),
    [colors],
  );
}

const cutOffTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function ChatRow({ chat, styles, onSkip }: { chat: InterruptedChat; styles: ReturnType<typeof useStyles>; onSkip(): void }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {chat.title}
        </Text>
        <Text style={styles.meta}>
          Cut off at {cutOffTime(chat.cutOffAt)} while {chat.lastStep}
        </Text>
      </View>
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={onSkip}>
        <Text style={styles.secondaryText}>Skip</Text>
      </Pressable>
    </View>
  );
}

export function ResumePopover(props: PluginPopoverProps) {
  const styles = useStyles(props.theme);
  const { data: chats = [] } = useInterruptedChats();
  const { continueAll, skip } = useResumeActions();
  const [failures, setFailures] = useState<string[]>([]);
  const titleOf = (agentId: string) => chats.find((chat) => chat.agentId === agentId)?.title ?? agentId;
  const ids = chats.map((chat) => chat.agentId);

  const onContinueAll = async () => {
    const result = await continueAll.mutateAsync(ids);
    setFailures(result.failed.map(({ agentId, error }) => `${titleOf(agentId)}: ${error}`));
    if (!result.failed.length) props.close();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>
        {chats.length ? `${chats.length} ${plural(chats.length)} stopped mid-turn` : "Nothing left to resume"}
      </Text>
      <Text style={styles.note}>
        Continue all sends “continue” to each one. Skip any that were doing something you'd rather check first.
      </Text>
      <ScrollView>
        {chats.map((chat) => (
          <ChatRow key={chat.agentId} chat={chat} styles={styles} onSkip={() => skip.mutate([chat.agentId])} />
        ))}
      </ScrollView>
      {failures.map((failure) => (
        <Text key={failure} style={styles.error}>
          {failure}
        </Text>
      ))}
      {continueAll.error ? <Text style={styles.error}>{continueAll.error.message}</Text> : null}
      {chats.length ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={styles.primary}
            disabled={continueAll.isPending}
            onPress={() => void onContinueAll()}
          >
            <Text style={styles.primaryText}>{continueAll.isPending ? "Continuing…" : "Continue all"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => skip.mutate(ids)}>
            <Text style={styles.secondaryText}>Skip all</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
