import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { askChat } from "../shared/contracts";

const askKeys = { chats: ["paseo-ask-tab", "chats"] as const };
const PAGE_LIMIT = 200;

interface ChatChoice {
  agentId: string;
  /** The chat's own title, which Paseo takes from its first message. */
  title: string;
  /** Paseo's summary title for the workspace; reads better than a first message. */
  workspaceTitle: string | null;
  workspaceId: string | null;
  busy: boolean;
  updatedAt: string;
}

function useChats() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: askKeys.chats,
    queryFn: async (): Promise<ChatChoice[]> => {
      const [agents, workspaces] = await Promise.all([
        paseo.agents.list({ page: { limit: PAGE_LIMIT } }),
        paseo.workspaces.list({ page: { limit: PAGE_LIMIT } }),
      ]);
      const workspaceTitles = new Map(
        workspaces.entries.map((workspace) => [workspace.id, workspace.title ?? workspace.name]),
      );
      return agents.entries
        .map(({ agent }) => agent)
        .filter((agent) => !agent.archivedAt)
        .map((agent) => ({
          agentId: agent.id,
          title: agent.title ?? "Untitled chat",
          workspaceTitle: agent.workspaceId
            ? (workspaceTitles.get(agent.workspaceId) ?? null)
            : null,
          workspaceId: agent.workspaceId ?? null,
          busy: agent.status === "running",
          updatedAt: agent.updatedAt,
        }));
    },
    refetchInterval: 5_000,
  });
}

function createStyles({ colors }: PluginTheme) {
  return {
    root: { flex: 1, backgroundColor: colors.surface0 },
    content: {
      padding: 16,
      gap: 10,
      maxWidth: 760,
      width: "100%" as const,
      alignSelf: "center" as const,
    },
    input: {
      fontSize: 14,
      minHeight: 72,
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      textAlignVertical: "top" as const,
    },
    section: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.foregroundMuted,
      marginTop: 6,
    },
    note: { fontSize: 12, color: colors.foregroundMuted },
    error: { fontSize: 12, color: colors.statusDanger },
    chat: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
    },
    chatPressed: { backgroundColor: colors.surface1 },
    chatTitle: { flex: 1, fontSize: 13, color: colors.foreground },
    chatBusy: { fontSize: 12, color: colors.statusWarning },
  };
}

export function AskScreen(props: PluginScreenProps) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme]);
  const toast = useToast();
  const ask = useRpc(askChat);
  const { from, fromTitle = "another chat", q = "" } = props.params;
  const [question, setQuestion] = useState(q);
  const { data: chats = [], error: listError } = useChats();
  const sending = useMutation({
    mutationFn: (target: { agentId: string; name: string }) =>
      ask({
        fromAgentId: from ?? "",
        fromTitle,
        toAgentId: target.agentId,
        toTitle: target.name,
        question: question.trim(),
      }),
    onSuccess: (_result, target) => {
      toast.show(`Asked "${target.name}". Its answer will arrive in this chat.`, {
        variant: "success",
      });
      if (from) props.navigation?.openAgent({ agentId: from });
    },
  });

  const fromChat = chats.find((chat) => chat.agentId === from);
  const others = chats
    .filter((chat) => chat.agentId !== from)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sameWorkspace = others.filter(
    (chat) => fromChat?.workspaceId && chat.workspaceId === fromChat.workspaceId,
  );
  const elsewhere = others.filter((chat) => !sameWorkspace.includes(chat));

  if (!from)
    return <Text style={[styles.error, { padding: 16 }]}>Open this from a chat with /ask.</Text>;

  // Tabs of one workspace share its title, so only the chat's own title tells them apart.
  const renderChat = (chat: ChatChoice, inThisWorkspace: boolean) => {
    const name = inThisWorkspace ? chat.title : (chat.workspaceTitle ?? chat.title);
    return (
      <Pressable
        key={chat.agentId}
        accessibilityRole="button"
        disabled={!question.trim() || chat.busy || sending.isPending}
        onPress={() => sending.mutate({ agentId: chat.agentId, name })}
        style={({ pressed }) => [
          styles.chat,
          pressed && styles.chatPressed,
          (!question.trim() || chat.busy) && { opacity: 0.5 },
        ]}
      >
        <Text style={styles.chatTitle} numberOfLines={1}>
          {name}
        </Text>
        {chat.busy ? <Text style={styles.chatBusy}>working</Text> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        autoFocus={!q}
        multiline
        value={question}
        onChangeText={setQuestion}
        placeholder="What do you want to ask?"
        placeholderTextColor={props.theme.colors.foregroundMuted}
        style={styles.input}
      />
      <Text style={styles.note}>
        Pick the chat to ask. Its reply comes back to "{fromTitle}" on its own.
      </Text>
      {sending.error ? <Text style={styles.error}>{sending.error.message}</Text> : null}
      {listError ? <Text style={styles.error}>{listError.message}</Text> : null}
      {sameWorkspace.length ? <Text style={styles.section}>This workspace</Text> : null}
      {sameWorkspace.map((chat) => renderChat(chat, true))}
      {elsewhere.length ? <Text style={styles.section}>Other chats</Text> : null}
      {elsewhere.map((chat) => renderChat(chat, false))}
    </ScrollView>
  );
}
