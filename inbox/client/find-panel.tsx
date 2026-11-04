import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { getRecentReviews, searchReviewTargets, type PullRequestCard } from "../shared/review";

const findKeys = {
  recent: ["paseo-review", "recent"] as const,
  search: (text: string) => ["paseo-review", "search", text] as const,
};
const DEBOUNCE_MS = 300;

function createStyles({ colors }: PluginTheme) {
  return {
    root: { gap: 14 },
    input: {
      fontSize: 14,
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    section: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
      gap: 6,
    },
    label: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.foreground,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    row: {
      backgroundColor: colors.surface0,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: 9,
      paddingHorizontal: 12,
      gap: 3,
    },
    rowPressed: { backgroundColor: colors.surface2 },
    title: { fontSize: 14, fontWeight: "500" as const, color: colors.foreground },
    meta: { fontSize: 12, color: colors.foregroundMuted },
    note: { fontSize: 12, color: colors.foregroundMuted, paddingHorizontal: 6 },
    error: { fontSize: 12, color: colors.statusDanger, paddingHorizontal: 6 },
  };
}
type Styles = ReturnType<typeof createStyles>;

const STATE_LABELS: Record<PullRequestCard["state"], string> = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
};

function ago(iso: string): string {
  const hours = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Card({ card, styles, onOpen }: { card: PullRequestCard; styles: Styles; onOpen(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.title} numberOfLines={1}>
        {card.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {card.repo.split("/").at(-1)}#{card.number} · {card.author} · {STATE_LABELS[card.state]} ·
        updated {ago(card.updatedAt)}
      </Text>
    </Pressable>
  );
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** Search your orgs' PRs, or pick one you opened recently, and open it in the review screen. */
export function FindPanel({
  theme,
  openReview,
}: {
  theme: PluginTheme;
  openReview(repo: string, number: number): void;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [text, setText] = useState("");
  const query = useDebounced(text.trim());
  const loadRecent = useRpc(getRecentReviews);
  const search = useRpc(searchReviewTargets);
  const recent = useQuery({ queryKey: findKeys.recent, queryFn: () => loadRecent({}) });
  const results = useQuery({
    queryKey: findKeys.search(query),
    queryFn: () => search({ text: query }),
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
  });
  const open = (card: PullRequestCard) => openReview(card.repo, card.number);

  return (
    <View style={styles.root}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Search PR titles, or paste a link, owner/repo#123 or #123"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
      />
      {query ? (
        <View style={styles.section}>
          <Text style={styles.label}>Results</Text>
          {results.isFetching && !results.data ? <ActivityIndicator /> : null}
          {results.error ? <Text style={styles.error}>{results.error.message}</Text> : null}
          {results.data && !results.data.results.length ? (
            <Text style={styles.note}>No PRs match.</Text>
          ) : null}
          {results.data?.results.map((card) => (
            <Card
              key={`${card.repo}#${card.number}`}
              card={card}
              styles={styles}
              onOpen={() => open(card)}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.label}>Recently reviewed</Text>
        {recent.data && !recent.data.recent.length ? (
          <Text style={styles.note}>PRs you open for review show up here.</Text>
        ) : null}
        {recent.data?.recent.map((card) => (
          <Card
            key={`${card.repo}#${card.number}`}
            card={card}
            styles={styles}
            onOpen={() => open(card)}
          />
        ))}
      </View>
    </View>
  );
}
