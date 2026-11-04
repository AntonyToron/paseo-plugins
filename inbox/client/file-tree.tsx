import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ScrollView, Text, View } from "react-native";
import { folderRows } from "../shared/file-tree";
import type { ReviewFile } from "../shared/review";
import { HoverPressable } from "./hover";

export interface TreeSection {
  id: string;
  label: string;
  files: ReviewFile[];
  open: boolean;
}

type Mode = "folders" | "order";

const INDENT = 12;
const isViewed = (file: ReviewFile) => file.viewed === "VIEWED";
const baseName = (path: string) => path.split("/").at(-1) ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");

function createTreeStyles({ colors }: PluginTheme, compact: boolean) {
  return {
    // A ScrollView flexes to fill a row by default; pin the tree's width.
    tree: {
      width: compact ? ("100%" as const) : 300,
      flexGrow: 0,
      flexShrink: 0,
      maxHeight: compact ? 220 : undefined,
      borderRightWidth: compact ? 0 : 1,
      borderBottomWidth: compact ? 1 : 0,
      borderColor: colors.border,
    },
    content: { paddingVertical: 10, paddingHorizontal: 8, gap: 1 },
    modes: { flexDirection: "row" as const, gap: 4, paddingHorizontal: 6, paddingBottom: 6 },
    mode: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
    modeActive: { backgroundColor: colors.surface2 },
    modeLabel: { fontSize: 11, color: colors.foregroundMuted },
    modeLabelActive: { color: colors.foreground },
    heading: {
      fontSize: 11,
      fontWeight: "600" as const,
      color: colors.foregroundMuted,
      paddingHorizontal: 6,
      paddingTop: 10,
      paddingBottom: 4,
      letterSpacing: 0.3,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingVertical: 4,
      paddingRight: 6,
      borderRadius: 5,
    },
    rowHovered: { backgroundColor: colors.surface1 },
    rowActive: { backgroundColor: colors.surface2 },
    // The file in view: a bar at the row's left edge, like an editor's open tab.
    activeBar: {
      position: "absolute" as const,
      left: 0,
      top: 4,
      bottom: 4,
      width: 2,
      borderRadius: 1,
      backgroundColor: colors.accent,
    },
    modeHovered: { backgroundColor: colors.surface1 },
    linkHovered: { textDecorationLine: "underline" as const },
    comments: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 3,
    },
    commentCount: { fontSize: 11, fontWeight: "600" as const, color: colors.statusWarning },
    chevron: { fontSize: 10, width: 10, color: colors.foregroundMuted },
    dirName: { flex: 1, fontSize: 12, color: colors.foreground },
    name: { flex: 1, fontSize: 12, color: colors.foreground },
    viewed: { color: colors.foregroundMuted, opacity: 0.6 },
    dirHint: { fontSize: 11, color: colors.foregroundMuted },
    stat: { fontSize: 11, color: colors.foregroundMuted },
    link: { color: colors.accent },
    foldedNote: { paddingHorizontal: 6, paddingTop: 12 },
  };
}
type TreeStyles = ReturnType<typeof createTreeStyles>;

function FileRow({
  file,
  depth,
  showDir,
  active,
  comments,
  styles,
  theme,
  onJump,
}: {
  file: ReviewFile;
  depth: number;
  showDir: boolean;
  active: boolean;
  comments: number;
  styles: TreeStyles;
  theme: PluginTheme;
  onJump(file: ReviewFile): void;
}) {
  const dir = showDir ? dirName(file.path) : "";
  return (
    <HoverPressable
      accessibilityRole="button"
      onPress={() => onJump(file)}
      style={({ hovered }) => [
        styles.row,
        { paddingLeft: 6 + depth * INDENT + 16 },
        hovered && styles.rowHovered,
        active && styles.rowActive,
      ]}
    >
      {active ? <View style={styles.activeBar} /> : null}
      <Text style={[styles.name, isViewed(file) && styles.viewed]} numberOfLines={1}>
        {baseName(file.path)}
        {dir ? <Text style={styles.dirHint}>{`  ${dir}`}</Text> : null}
      </Text>
      {comments ? (
        <View style={styles.comments}>
          <Icon name="MessageSquare" size={11} color={theme.colors.statusWarning} />
          <Text style={styles.commentCount}>{comments}</Text>
        </View>
      ) : null}
      <Text style={styles.stat}>{file.additions + file.deletions}</Text>
    </HoverPressable>
  );
}

/**
 * The PR's files by folder, the way GitHub's tree shows them, or in Claude's reading order once
 * it has sorted them. Folders show how many files they hold, so crowded ones stand out. Like the
 * diff, the tree leaves out folded sections (tests, generated files) until asked for them.
 */
export function FileTree({
  sections,
  sorted,
  activePath,
  commentCounts,
  theme,
  compact,
  onJump,
}: {
  sections: readonly TreeSection[];
  sorted: boolean;
  activePath: string | null;
  commentCounts: ReadonlyMap<string, number>;
  theme: PluginTheme;
  compact: boolean;
  onJump(file: ReviewFile): void;
}) {
  const styles = useMemo(() => createTreeStyles(theme, compact), [theme, compact]);
  const [mode, setMode] = useState<Mode>("folders");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [showFolded, setShowFolded] = useState(false);
  const listed = (section: TreeSection) => section.open || showFolded;
  const foldedCount = sections
    .filter((section) => !section.open)
    .reduce((sum, section) => sum + section.files.length, 0);
  const files = useMemo(
    () =>
      sections.filter((section) => section.open || showFolded).flatMap((section) => section.files),
    [sections, showFolded],
  );
  const rows = useMemo(() => folderRows(files, closed), [files, closed]);
  const shown: Mode = sorted ? mode : "folders";

  const toggleDir = (path: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const fileRow = (file: ReviewFile, depth: number, showDir: boolean) => (
    <FileRow
      key={file.path}
      file={file}
      depth={depth}
      showDir={showDir}
      active={file.path === activePath}
      comments={commentCounts.get(file.path) ?? 0}
      styles={styles}
      theme={theme}
      onJump={onJump}
    />
  );

  return (
    <ScrollView style={styles.tree} contentContainerStyle={styles.content}>
      {sorted ? (
        <View style={styles.modes}>
          {(
            [
              ["folders", "Folders"],
              ["order", "Reading order"],
            ] as const
          ).map(([value, label]) => (
            <HoverPressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: shown === value }}
              onPress={() => setMode(value)}
              style={({ hovered }) => [
                styles.mode,
                hovered && styles.modeHovered,
                shown === value && styles.modeActive,
              ]}
            >
              <Text style={[styles.modeLabel, shown === value && styles.modeLabelActive]}>
                {label}
              </Text>
            </HoverPressable>
          ))}
        </View>
      ) : null}
      {shown === "folders"
        ? rows.map((row) =>
            row.kind === "dir" ? (
              <HoverPressable
                key={`dir:${row.path}`}
                accessibilityRole="button"
                onPress={() => toggleDir(row.path)}
                style={({ hovered }) => [
                  styles.row,
                  { paddingLeft: 6 + row.depth * INDENT },
                  hovered && styles.rowHovered,
                ]}
              >
                <Text style={styles.chevron}>{row.open ? "▾" : "▸"}</Text>
                <Icon
                  name={row.open ? "FolderOpen" : "Folder"}
                  size={13}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={styles.dirName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.stat}>
                  {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                </Text>
              </HoverPressable>
            ) : (
              fileRow(row.file, row.depth, false)
            ),
          )
        : sections.map((section) => (
            <View key={section.id}>
              <Text style={styles.heading}>
                {section.label.toUpperCase()} · {section.files.length}
                {section.open ? "" : " · folded"}
              </Text>
              {listed(section) ? section.files.map((file) => fileRow(file, -1, true)) : null}
            </View>
          ))}
      {foldedCount ? (
        <HoverPressable
          accessibilityRole="button"
          onPress={() => setShowFolded(!showFolded)}
          style={styles.foldedNote}
        >
          {({ hovered }) => (
            <Text style={styles.stat}>
              {showFolded
                ? "Hide the folded sections' files"
                : `${foldedCount} ${foldedCount === 1 ? "file" : "files"} in folded sections not shown. `}
              {showFolded ? null : (
                <Text style={[styles.link, hovered && styles.linkHovered]}>Show</Text>
              )}
            </Text>
          )}
        </HoverPressable>
      ) : null}
    </ScrollView>
  );
}
