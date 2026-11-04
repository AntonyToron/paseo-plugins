import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { folderRows } from "../shared/file-tree";
import type { ReviewFile } from "../shared/review";

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
      paddingVertical: 3,
      paddingRight: 6,
      borderRadius: 5,
    },
    rowActive: { backgroundColor: colors.surface2 },
    chevron: { fontSize: 10, width: 10, color: colors.foregroundMuted },
    dirName: { flex: 1, fontSize: 12, color: colors.foreground },
    name: { flex: 1, fontSize: 12, color: colors.foreground },
    viewed: { color: colors.foregroundMuted, opacity: 0.6 },
    dirHint: { fontSize: 11, color: colors.foregroundMuted },
    stat: { fontSize: 11, color: colors.foregroundMuted },
  };
}
type TreeStyles = ReturnType<typeof createTreeStyles>;

function FileRow({
  file,
  depth,
  showDir,
  active,
  styles,
  onJump,
}: {
  file: ReviewFile;
  depth: number;
  showDir: boolean;
  active: boolean;
  styles: TreeStyles;
  onJump(file: ReviewFile): void;
}) {
  const dir = showDir ? dirName(file.path) : "";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onJump(file)}
      style={[styles.row, { paddingLeft: 6 + depth * INDENT + 16 }, active && styles.rowActive]}
    >
      <Text style={[styles.name, isViewed(file) && styles.viewed]} numberOfLines={1}>
        {baseName(file.path)}
        {dir ? <Text style={styles.dirHint}>{`  ${dir}`}</Text> : null}
      </Text>
      <Text style={styles.stat}>{file.additions + file.deletions}</Text>
    </Pressable>
  );
}

/**
 * The PR's files by folder, the way GitHub's tree shows them, or in Claude's reading order once
 * it has sorted them. Folders show how many files they hold, so crowded ones stand out.
 */
export function FileTree({
  files,
  sections,
  sorted,
  activePath,
  theme,
  compact,
  onJump,
}: {
  files: readonly ReviewFile[];
  sections: readonly TreeSection[];
  sorted: boolean;
  activePath: string | null;
  theme: PluginTheme;
  compact: boolean;
  onJump(file: ReviewFile): void;
}) {
  const styles = useMemo(() => createTreeStyles(theme, compact), [theme, compact]);
  const [mode, setMode] = useState<Mode>("folders");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => folderRows(files, closed), [files, closed]);
  const shown: Mode = sorted ? mode : "folders";

  const toggleDir = (path: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

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
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: shown === value }}
              onPress={() => setMode(value)}
              style={[styles.mode, shown === value && styles.modeActive]}
            >
              <Text style={[styles.modeLabel, shown === value && styles.modeLabelActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {shown === "folders"
        ? rows.map((row) =>
            row.kind === "dir" ? (
              <Pressable
                key={`dir:${row.path}`}
                accessibilityRole="button"
                onPress={() => toggleDir(row.path)}
                style={[styles.row, { paddingLeft: 6 + row.depth * INDENT }]}
              >
                <Text style={styles.chevron}>{row.open ? "▾" : "▸"}</Text>
                <Text style={styles.dirName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.stat}>
                  {row.fileCount} {row.fileCount === 1 ? "file" : "files"}
                </Text>
              </Pressable>
            ) : (
              <FileRow
                key={row.file.path}
                file={row.file}
                depth={row.depth}
                showDir={false}
                active={row.file.path === activePath}
                styles={styles}
                onJump={onJump}
              />
            ),
          )
        : sections.map((section) => (
            <View key={section.id}>
              <Text style={styles.heading}>
                {section.label.toUpperCase()} · {section.files.length}
                {section.open ? "" : " · folded"}
              </Text>
              {section.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  depth={-1}
                  showDir
                  active={file.path === activePath}
                  styles={styles}
                  onJump={onJump}
                />
              ))}
            </View>
          ))}
    </ScrollView>
  );
}
