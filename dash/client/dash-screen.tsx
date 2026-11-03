import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { GROUP_LABELS, type DashRow, type Group } from "../shared/model";
import {
  dashKeys,
  reReviewPrompt,
  relativeTime,
  useDashSnapshot,
  type DashGroupRows,
} from "./use-dash";

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
    group: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
      gap: 6,
    },
    groupHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 6,
      paddingTop: 4,
      paddingBottom: 2,
    },
    groupDot: { width: 8, height: 8, borderRadius: 4 },
    groupLabel: { fontSize: 13, fontWeight: "600" as const, color: colors.foreground },
    count: {
      fontSize: 11,
      color: colors.foregroundMuted,
      backgroundColor: colors.surface2,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 1,
      overflow: "hidden" as const,
    },
    headerSpacer: { flex: 1 },
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
      backgroundColor: colors.surface2,
    },
    primaryButton: { backgroundColor: colors.accent },
    buttonText: { fontSize: 12, color: colors.foreground },
    primaryText: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
    warnText: { fontSize: 12, color: colors.statusWarning },
    empty: {
      fontSize: 13,
      color: colors.foregroundMuted,
      textAlign: "center" as const,
      marginTop: 40,
    },
    error: { fontSize: 13, color: colors.statusDanger },
  };
}

/** Each group's colour, used for its header dot and its rows' left stripe. */
function groupColor(group: Group, { colors }: PluginTheme): string {
  switch (group) {
    case "needs-you":
      return colors.statusDanger;
    case "relook":
      return colors.statusWarning;
    case "working":
    case "unread":
      return colors.accent;
    case "waiting":
      return colors.foregroundMuted;
    // The theme accent can itself be green, so finished work stays quiet rather than success-green.
    case "done":
      return colors.border;
  }
}

const detailColor = (group: Group, { colors }: PluginTheme) =>
  group === "needs-you"
    ? colors.statusDanger
    : group === "relook"
      ? colors.statusWarning
      : colors.foregroundMuted;

/** Web bubbles a button press to the row underneath, which would also open the chat. */
const stop = (event?: GestureResponderEvent) => event?.stopPropagation?.();

function SmallButton({
  label,
  styles,
  warn,
  primary,
  onPress,
}: {
  label: string;
  styles: Styles;
  warn?: boolean;
  primary?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.button, primary && styles.primaryButton]}
      onPress={(event) => {
        stop(event);
        onPress();
      }}
    >
      <Text style={warn ? styles.warnText : primary ? styles.primaryText : styles.buttonText}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  row,
  props,
  styles,
  onArchive,
}: {
  row: DashRow;
  props: PluginScreenProps;
  styles: Styles;
  onArchive(row: DashRow): void;
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const { navigation } = props;

  const open = () => {
    if (row.agentId) navigation?.openAgent({ agentId: row.agentId });
    else navigation?.openWorkspace({ workspaceId: row.workspaceId });
  };
  const reReview = async () => {
    if (!row.agentId) return;
    try {
      await paseo.agents.ref(row.agentId).send(reReviewPrompt(row));
      void queryClient.invalidateQueries({ queryKey: dashKeys.snapshot });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const archive = () => {
    if (row.archiveRisks.length && !confirmingArchive) setConfirmingArchive(true);
    else onArchive(row);
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [
        styles.row,
        { borderLeftColor: groupColor(row.group, props.theme) },
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.lineOne}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.time}>{relativeTime(row.activityAt)}</Text>
      </View>
      <View style={styles.lineTwo}>
        <Text
          style={[styles.detail, { color: detailColor(row.group, props.theme) }]}
          numberOfLines={1}
        >
          {row.detail}
        </Text>
        {row.group === "relook" && row.agentId ? (
          <SmallButton label="Re-review" primary styles={styles} onPress={() => void reReview()} />
        ) : null}
        {row.group === "done" ? (
          <SmallButton
            label={
              confirmingArchive ? `Archive anyway? Loses ${row.archiveRisks.join(", ")}` : "Archive"
            }
            warn={confirmingArchive}
            styles={styles}
            onPress={archive}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Rows re-sort by activity every refresh, which moves them under the cursor. While the screen is
 * open, a row keeps the place it first had in the list, and new rows go first.
 */
function useSteadyOrder(groups: readonly DashGroupRows[] | undefined): DashGroupRows[] | undefined {
  const ranks = useRef<Map<string, number> | null>(null);
  const nextTopRank = useRef(-1);
  if (!groups) return undefined;
  const rows = groups.flatMap((entry) => entry.rows);
  if (!ranks.current) {
    ranks.current = new Map(rows.map((row, index) => [row.workspaceId, index]));
  } else {
    for (const row of rows)
      if (!ranks.current.has(row.workspaceId))
        ranks.current.set(row.workspaceId, nextTopRank.current--);
  }
  const known = ranks.current;
  const rankOf = (row: DashRow) => known.get(row.workspaceId) ?? 0;
  return groups.map((entry) => ({
    ...entry,
    rows: [...entry.rows].sort((a, b) => rankOf(a) - rankOf(b)),
  }));
}

export function DashScreen(props: PluginScreenProps) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme]);
  const paseo = usePaseo();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: liveGroups, error, isPending } = useDashSnapshot();
  const groups = useSteadyOrder(liveGroups);

  const archiveRows = async (rows: readonly DashRow[]) => {
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const result = await paseo.workspaces.archive(row.workspaceId);
        if (result.error) failed.push(`${row.title}: ${result.error}`);
      } catch (cause) {
        failed.push(`${row.title}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    void queryClient.invalidateQueries({ queryKey: dashKeys.snapshot });
    return failed;
  };

  const archiveOne = async (row: DashRow) => {
    const [failure] = await archiveRows([row]);
    if (failure) toast.error(failure);
  };

  const archiveAll = async (rows: readonly DashRow[]) => {
    // Worktrees with unsaved work stay; archiving one of those is a per-row decision.
    const safe = rows.filter((row) => !row.archiveRisks.length);
    const kept = rows.length - safe.length;
    const failed = await archiveRows(safe);
    const archived = safe.length - failed.length;
    const parts = [
      `Archived ${archived}`,
      kept && `kept ${kept} with unsaved work`,
      failed.length && `${failed.length} failed`,
    ];
    toast.show(parts.filter(Boolean).join(", "), { variant: failed.length ? "error" : "success" });
  };

  if (isPending) {
    return (
      <View style={[styles.root, { justifyContent: "center", alignItems: "center", gap: 8 }]}>
        <ActivityIndicator />
        <Text style={styles.empty}>
          Reading your chats and their PRs. The first look takes a little while.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      {groups?.length ? null : <Text style={styles.empty}>No open workspaces.</Text>}
      {groups?.map(({ group, rows }) => (
        <View key={group} style={styles.group}>
          <View style={styles.groupHeader}>
            <View style={[styles.groupDot, { backgroundColor: groupColor(group, props.theme) }]} />
            <Text style={styles.groupLabel}>{GROUP_LABELS[group]}</Text>
            <Text style={styles.count}>{rows.length}</Text>
            <View style={styles.headerSpacer} />
            {group === "done" ? (
              <SmallButton
                label="Archive all"
                styles={styles}
                onPress={() => void archiveAll(rows)}
              />
            ) : null}
          </View>
          {rows.map((row) => (
            <Row
              key={row.workspaceId}
              row={row}
              props={props}
              styles={styles}
              onArchive={(target) => void archiveOne(target)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
