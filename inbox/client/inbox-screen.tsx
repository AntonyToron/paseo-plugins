import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { getInbox, startReview } from "../shared/contracts";
import { FindPanel } from "./find-panel";
import type { InboxItem, InboxSnapshot } from "../shared/model";

export const inboxKeys = { snapshot: ["paseo-inbox", "snapshot"] as const };
const REFRESH_MS = 60_000;

export function useInbox() {
  const load = useRpc(getInbox);
  return useQuery({
    queryKey: inboxKeys.snapshot,
    queryFn: () => load({}),
    refetchInterval: REFRESH_MS,
  });
}

/** Asks GitHub now instead of reading the couple-of-minutes-old shared answer. */
function useRefreshInbox() {
  const load = useRpc(getInbox);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => load({ refresh: true }),
    onSuccess: (snapshot) => queryClient.setQueryData(inboxKeys.snapshot, snapshot),
  });
}

/** What the sidebar badge counts: things to look at first, and your PRs that need you. */
export const needsYouCount = (snapshot: InboxSnapshot) =>
  snapshot.priority.length + snapshot.mine.length;

type Styles = ReturnType<typeof createStyles>;

function createStyles({ colors }: PluginTheme) {
  return {
    root: { flex: 1, backgroundColor: colors.surface0 },
    content: {
      padding: 20,
      gap: 16,
      maxWidth: 820,
      width: "100%" as const,
      alignSelf: "center" as const,
    },
    section: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
      gap: 6,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 6,
      paddingTop: 4,
      paddingBottom: 2,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: { fontSize: 13, fontWeight: "600" as const, color: colors.foreground },
    count: {
      fontSize: 11,
      color: colors.foregroundMuted,
      backgroundColor: colors.surface2,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 1,
      overflow: "hidden" as const,
    },
    spacer: { flex: 1 },
    note: { fontSize: 12, color: colors.foregroundMuted, paddingHorizontal: 6, paddingBottom: 2 },
    row: {
      backgroundColor: colors.surface0,
      borderColor: colors.border,
      borderWidth: 1,
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 3,
    },
    rowPressed: { backgroundColor: colors.surface2 },
    lineOne: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    title: { flex: 1, fontSize: 14, fontWeight: "500" as const, color: colors.foreground },
    time: { fontSize: 12, color: colors.foregroundMuted },
    lineTwo: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      minHeight: 22,
    },
    detail: { flex: 1, fontSize: 12, color: colors.foregroundMuted },
    button: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
    buttonText: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
    secondaryButton: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: colors.surface2,
    },
    secondaryText: { fontSize: 12, color: colors.foreground },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    },
    tabs: {
      flexDirection: "row" as const,
      gap: 2,
      padding: 3,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
    tabActive: { backgroundColor: colors.surface2 },
    tabText: { fontSize: 13, color: colors.foregroundMuted },
    tabTextActive: { color: colors.foreground, fontWeight: "600" as const },
    updated: { fontSize: 12, color: colors.foregroundMuted },
    triageNote: { fontSize: 12, color: colors.foregroundMuted, textAlign: "center" as const },
    triageError: { fontSize: 12, color: colors.statusWarning, textAlign: "center" as const },
    toggle: { fontSize: 12, color: colors.foregroundMuted },
    empty: {
      fontSize: 13,
      color: colors.foregroundMuted,
      textAlign: "center" as const,
      marginTop: 40,
    },
    error: { fontSize: 13, color: colors.statusDanger },
  };
}

function updatedAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

function age(iso: string): string {
  if (!iso) return "";
  const hours = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const shortRepo = (repo: string) => repo.split("/").at(-1) ?? repo;

/** Web bubbles a button press to the row underneath, which would also open GitHub. */
const stop = (event?: GestureResponderEvent) => event?.stopPropagation?.();

export type InboxScreenProps = PluginScreenProps & {
  openReview(repo: string, number: number): void;
};

function Row({
  item,
  color,
  styles,
  props,
}: {
  item: InboxItem;
  color: string;
  styles: Styles;
  props: InboxScreenProps;
}) {
  const toast = useToast();
  const start = useRpc(startReview);
  const starting = useMutation({
    mutationFn: () =>
      start({ repo: item.repo, number: item.number, title: item.title, url: item.url }),
    onSuccess: ({ agentId }) => props.navigation?.openAgent({ agentId }),
    onError: (error) => toast.error(error.message),
  });
  const author = item.kind === "review" ? ` · ${item.author}` : "";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void openExternalUrl(item.url)}
      style={({ pressed }) => [
        styles.row,
        { borderLeftColor: color },
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.lineOne}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.time}>{age(item.since)}</Text>
      </View>
      <View style={styles.lineTwo}>
        <Text style={styles.detail} numberOfLines={1}>
          {shortRepo(item.repo)}#{item.number}
          {author} · {item.reason}
        </Text>
        {item.slackUrl ? (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={(event) => {
              stop(event);
              void openExternalUrl(item.slackUrl as string);
            }}
          >
            <Text style={styles.secondaryText}>Slack</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={(event) => {
            stop(event);
            props.openReview(item.repo, item.number);
          }}
        >
          <Text style={styles.secondaryText}>Files</Text>
        </Pressable>
        {item.kind === "review" ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            disabled={starting.isPending}
            onPress={(event) => {
              stop(event);
              starting.mutate();
            }}
          >
            <Text style={styles.buttonText}>
              {starting.isPending ? "Starting…" : "Start review"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function Section({
  title,
  items,
  color,
  styles,
  props,
  note,
  collapsible,
}: {
  title: string;
  items: readonly InboxItem[];
  color: string;
  styles: Styles;
  props: InboxScreenProps;
  note?: string;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (!items.length && !note) return null;
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        disabled={!collapsible}
        onPress={() => setOpen(!open)}
        style={styles.header}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.count}>{items.length}</Text>
        <View style={styles.spacer} />
        {collapsible ? <Text style={styles.toggle}>{open ? "Hide" : "Show"}</Text> : null}
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {open
        ? items.map((item) => (
            <Row key={item.url} item={item} color={color} styles={styles} props={props} />
          ))
        : null}
    </View>
  );
}

export function InboxScreen(props: InboxScreenProps) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme]);
  const { colors } = props.theme;
  const { data, error, isPending } = useInbox();
  const refresh = useRefreshInbox();
  const [tab, setTab] = useState<"needs" | "mine" | "find">("needs");

  if (isPending) {
    return (
      <View style={[styles.root, { justifyContent: "center", alignItems: "center", gap: 8 }]}>
        <ActivityIndicator />
        <Text style={styles.empty}>Asking GitHub what's waiting on you…</Text>
      </View>
    );
  }
  if (!data)
    return (
      <Text style={[styles.error, { padding: 20 }]}>
        {error?.message ?? "Couldn't load your PRs."}
      </Text>
    );

  const quiet = data.quietMine
    ? `${data.quietMine} other open PR${data.quietMine === 1 ? "" : "s"} of yours have nothing for you to do.`
    : undefined;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.toolbar}>
        <View style={styles.tabs}>
          {(
            [
              ["needs", `Needs you · ${needsYouCount(data)}`],
              ["mine", `My PRs · ${data.allMine.length}`],
              ["find", "Find a PR"],
            ] as const
          ).map(([id, label]) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              onPress={() => setTab(id)}
              style={[styles.tab, tab === id && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.spacer} />
        <Text style={styles.updated}>
          {refresh.isPending ? "Asking GitHub…" : updatedAgo(data.fetchedAt)}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          disabled={refresh.isPending}
          onPress={() => refresh.mutate()}
        >
          <Text style={styles.secondaryText}>{refresh.isPending ? "Refreshing…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {refresh.error ? (
        <Text style={styles.error}>Couldn't refresh: {refresh.error.message}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      {tab === "mine" ? (
        <Section
          title="My open PRs"
          items={data.allMine}
          color={colors.accent}
          styles={styles}
          props={props}
          note="Drafts included. The ones that need something from you come first."
        />
      ) : null}
      {tab === "find" ? <FindPanel theme={props.theme} openReview={props.openReview} /> : null}
      {tab === "needs" && data.triage.pending ? (
        <Text style={styles.triageNote}>
          Claude is reading {data.triage.pending} older request
          {data.triage.pending === 1 ? "" : "s"} and checking Slack. Results move PRs up as they
          arrive.
        </Text>
      ) : null}
      {tab === "needs" && data.triage.error ? (
        <Text style={styles.triageError}>Claude's check stopped: {data.triage.error}</Text>
      ) : null}
      {tab === "needs" ? (
        <>
          <Section
            title="Look at these first"
            items={data.priority}
            color={colors.statusDanger}
            styles={styles}
            props={props}
          />
          <Section
            title="Your PRs"
            items={data.mine}
            color={colors.statusWarning}
            styles={styles}
            props={props}
            note={quiet}
          />
          <Section
            title="Review requests"
            items={data.reviews}
            color={colors.accent}
            styles={styles}
            props={props}
          />
          <Section
            title="Stale requests"
            items={data.stale}
            color={colors.foregroundMuted}
            styles={styles}
            props={props}
            note="Waiting on you for over 30 days, and not urgent."
            collapsible
          />
        </>
      ) : null}
    </ScrollView>
  );
}
