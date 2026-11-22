import type { PluginTheme } from "@getpaseo/plugin";
import {
  usePaseo,
  useWorkspace,
  useWorkspaces,
  type PluginSidebarViewProps,
} from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { DashRow, WorkspaceStatus } from "../shared/model";
import {
  FOLDED_BY_DEFAULT,
  placeWorkspace,
  readyToArchive,
  SIDEBAR_GROUP_LABELS,
  SIDEBAR_GROUPS,
  type SidebarGroup,
} from "../shared/sidebar";
import { relativeTime, useDashRowsByWorkspace } from "./use-dash";

type WorkspaceRef = Parameters<PluginSidebarViewProps["navigation"]["openWorkspace"]>[0];

const NO_ROWS: ReadonlyMap<string, DashRow> = new Map();

function createStyles({ colors }: PluginTheme) {
  return {
    list: { paddingHorizontal: 8, paddingBottom: 16, gap: 2 },
    groupHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 8,
      paddingTop: 12,
      paddingBottom: 4,
    },
    groupLabel: {
      flex: 1,
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.3,
      color: colors.foregroundMuted,
    },
    count: { fontSize: 11, color: colors.foregroundMuted },
    row: {
      flexDirection: "row" as const,
      gap: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
    },
    rowHovered: { backgroundColor: colors.surface1 },
    rowActive: { backgroundColor: colors.surface2 },
    dotColumn: { width: 10, paddingTop: 5, alignItems: "center" as const },
    dot: { width: 7, height: 7, borderRadius: 4 },
    body: { flex: 1, minWidth: 0, gap: 2 },
    topLine: { flexDirection: "row" as const, gap: 6, alignItems: "center" as const },
    title: { flex: 1, fontSize: 13, color: colors.foreground },
    time: { fontSize: 11, color: colors.foregroundMuted },
    detail: { fontSize: 12, color: colors.foregroundMuted },
    attention: { color: colors.statusWarning },
    action: { fontSize: 11, color: colors.accent },
  };
}
type Styles = ReturnType<typeof createStyles>;

function statusColor(status: WorkspaceStatus, { colors }: PluginTheme): string {
  switch (status) {
    case "needs_input":
      return colors.statusWarning;
    case "failed":
      return colors.statusDanger;
    case "attention":
      return colors.statusSuccess;
    case "running":
      return colors.accent;
    default:
      return "transparent";
  }
}

function WorkspaceRow({
  workspaceRef,
  dashRow,
  active,
  styles,
  theme,
  onOpen,
}: {
  workspaceRef: WorkspaceRef;
  dashRow: DashRow | undefined;
  active: boolean;
  styles: Styles;
  theme: PluginTheme;
  onOpen(ref: WorkspaceRef): void;
}) {
  const workspace = useWorkspace(workspaceRef);
  const paseo = usePaseo();
  const [hovered, setHovered] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (!workspace) return null;
  const pullRequest = dashRow?.pullRequest ?? null;
  const { detail } = placeWorkspace(workspace.indicator, pullRequest);
  const urgent = workspace.indicator === "needs_input" || workspace.indicator === "failed";
  const canArchive = readyToArchive(pullRequest, dashRow?.archiveRisks ?? []);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(workspaceRef)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.row, hovered && styles.rowHovered, active && styles.rowActive]}
    >
      <View style={styles.dotColumn}>
        {workspace.indicator === "running" ? (
          <ActivityIndicator size={8} color={theme.colors.accent} />
        ) : (
          <View
            style={[styles.dot, { backgroundColor: statusColor(workspace.indicator, theme) }]}
          />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.title} numberOfLines={1}>
            {workspace.title ?? workspace.name}
          </Text>
          {hovered && canArchive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Archive workspace"
              disabled={archiving}
              onPress={() => {
                setArchiving(true);
                void paseo.workspaces.archive(workspace.id).finally(() => setArchiving(false));
              }}
            >
              <Text style={styles.action}>{archiving ? "Archiving…" : "Archive"}</Text>
            </Pressable>
          ) : (
            <Text style={styles.time}>
              {relativeTime(workspace.lastPromptAt ?? dashRow?.activityAt ?? null)}
            </Text>
          )}
        </View>
        {detail ? (
          <Text style={[styles.detail, urgent && styles.attention]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The sidebar as Dash sees it: workspaces grouped by what they need from you, most urgent first,
 * with each one's PR state on its second line. Every open workspace is here somewhere; the long,
 * quiet groups start folded.
 */
export function NeedsMeView(props: PluginSidebarViewProps) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme]);
  const { data: rows = NO_ROWS } = useDashRowsByWorkspace();
  const [folded, setFolded] = useState<ReadonlySet<SidebarGroup>>(FOLDED_BY_DEFAULT);
  const groups = useWorkspaces({
    where: (workspace) => !workspace.archivingAt && !workspace.background,
    orderBy: (a, b) =>
      (b.lastPromptAt ?? b.statusEnteredAt ?? "").localeCompare(
        a.lastPromptAt ?? a.statusEnteredAt ?? "",
      ),
    groupBy: (workspace) =>
      placeWorkspace(workspace.indicator, rows.get(workspace.id)?.pullRequest ?? null).group,
  });
  const byGroup = new Map(groups.map((group) => [group.key, group.items]));
  const activeKey = props.active.workspace?.key ?? null;

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {SIDEBAR_GROUPS.map((group) => {
        const items = byGroup.get(group) ?? [];
        if (!items.length) return null;
        const isFolded = folded.has(group);
        return (
          <View key={group}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !isFolded }}
              onPress={() =>
                setFolded((current) => {
                  const next = new Set(current);
                  if (!next.delete(group)) next.add(group);
                  return next;
                })
              }
              style={styles.groupHeader}
            >
              <Text style={styles.count}>{isFolded ? "▸" : "▾"}</Text>
              <Text style={styles.groupLabel}>{SIDEBAR_GROUP_LABELS[group].toUpperCase()}</Text>
              <Text style={styles.count}>{items.length}</Text>
            </Pressable>
            {isFolded
              ? null
              : items.map((ref) => (
                  <WorkspaceRow
                    key={ref.key}
                    workspaceRef={ref}
                    dashRow={rows.get(ref.id)}
                    active={ref.key === activeKey}
                    styles={styles}
                    theme={props.theme}
                    onOpen={props.navigation.openWorkspace}
                  />
                ))}
          </View>
        );
      })}
    </ScrollView>
  );
}
