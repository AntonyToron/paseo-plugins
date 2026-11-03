import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { searchChats, type SearchResult } from "../shared/contracts";

const searchKeys = { query: (query: string) => ["paseo-chat-search", query] as const };
const DEBOUNCE_MS = 250;
const WHILE_INDEXING_MS = 2_000;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function useChatSearch(query: string) {
  const run = useRpc(searchChats);
  return useQuery({
    queryKey: searchKeys.query(query),
    queryFn: () => run({ query }),
    placeholderData: keepPreviousData,
    refetchInterval: (state) => (state.state.data?.indexing ? WHILE_INDEXING_MS : false),
  });
}

function createStyles({ colors }: PluginTheme) {
  return {
    root: { flex: 1, backgroundColor: colors.surface0 },
    content: { padding: 16, gap: 10, maxWidth: 820, width: "100%" as const, alignSelf: "center" as const },
    input: {
      fontSize: 15,
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    note: { fontSize: 12, color: colors.foregroundMuted },
    error: { fontSize: 12, color: colors.statusDanger },
    result: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, gap: 3 },
    resultPressed: { backgroundColor: colors.surface1 },
    lineOne: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const },
    title: { flex: 1, fontSize: 14, color: colors.foreground },
    meta: { fontSize: 12, color: colors.foregroundMuted },
    snippet: { fontSize: 12, color: colors.foregroundMuted, lineHeight: 17 },
  };
}

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

function Result({ result, styles, onOpen }: { result: SearchResult; styles: ReturnType<typeof createStyles>; onOpen(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}>
      <View style={styles.lineOne}>
        <Text style={styles.title} numberOfLines={1}>
          {result.title}
        </Text>
        <Text style={styles.meta}>
          {result.archived ? "archived · " : ""}
          {when(result.at)}
        </Text>
      </View>
      {result.snippet ? (
        <Text style={styles.snippet} numberOfLines={2}>
          {result.fromYou ? "You: " : "Claude: "}
          {result.snippet}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function SearchScreen(props: PluginScreenProps) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme]);
  const [query, setQuery] = useState(props.params.q ?? "");
  const debounced = useDebounced(query.trim());
  const { data, error } = useChatSearch(debounced);
  const indexing = data?.indexing;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextInput
        autoFocus
        value={query}
        onChangeText={setQuery}
        placeholder="Search what was said in any chat, e.g. webhook retries"
        placeholderTextColor={props.theme.colors.foregroundMuted}
        style={styles.input}
      />
      {indexing ? (
        <Text style={styles.note}>
          Reading your chats for the first time{indexing.total ? `: ${indexing.done} of ${indexing.total}` : "…"} Results fill
          in as it goes.
        </Text>
      ) : null}
      {data?.indexError ? <Text style={styles.error}>Indexing stopped, so results may be incomplete: {data.indexError}</Text> : null}
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      {debounced && data && !data.results.length && !indexing ? <Text style={styles.note}>No chat mentions all of those words.</Text> : null}
      {data?.results.map((result) => (
        <Result
          key={result.agentId}
          result={result}
          styles={styles}
          onOpen={() => props.navigation?.openAgent({ agentId: result.agentId })}
        />
      ))}
    </ScrollView>
  );
}
