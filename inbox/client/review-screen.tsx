import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type FlatList as NativeFlatList,
  type ViewToken,
} from "react-native";
import {
  FILE_GROUPS,
  FILE_GROUP_LABELS,
  getFileDiffs,
  getReviewFiles,
  githubFileUrl,
  parseDiff,
  setFilesViewed,
  type DiffLine,
  type FileGroup,
  type ReviewFile,
} from "../shared/review";
import { createDiffStyles, DiffLineRow, type DiffStyles } from "./diff-view";

const reviewKeys = {
  files: (repo: string, number: number) => ["paseo-review", repo, number, "files"] as const,
  diffs: (repo: string, number: number, headSha: string, group: FileGroup) =>
    ["paseo-review", repo, number, headSha, "diffs", group] as const,
};

// Big groups are fetched in a few calls rather than one huge one.
const DIFF_BATCH = 60;
// Tests and generated files stay folded until asked for: they're most of a big PR's lines.
const OPEN_BY_DEFAULT: ReadonlySet<FileGroup> = new Set(["source", "config"]);

type FilesResult = {
  title: string;
  url: string;
  author: string;
  headSha: string;
  files: ReviewFile[];
};
type Diffs = Record<string, { diff: string; truncated: boolean }>;

type Row =
  | { kind: "group"; key: string; group: FileGroup; files: ReviewFile[]; open: boolean }
  | { kind: "file"; key: string; file: ReviewFile; expanded: boolean }
  | { kind: "line"; key: string; line: DiffLine }
  | { kind: "status"; key: string; text: string };

const isViewed = (file: ReviewFile) => file.viewed === "VIEWED";
const baseName = (path: string) => path.split("/").at(-1) ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");

function createStyles({ colors }: PluginTheme, compact: boolean) {
  return {
    root: {
      flex: 1,
      flexDirection: compact ? ("column" as const) : ("row" as const),
      backgroundColor: colors.surface0,
    },
    // A ScrollView flexes to fill a row by default; pin the tree's width.
    tree: {
      width: compact ? ("100%" as const) : 280,
      flexGrow: 0,
      flexShrink: 0,
      maxHeight: compact ? 220 : undefined,
      borderRightWidth: compact ? 0 : 1,
      borderBottomWidth: compact ? 1 : 0,
      borderColor: colors.border,
    },
    treeContent: { paddingVertical: 10, paddingHorizontal: 8, gap: 1 },
    treeGroup: {
      fontSize: 11,
      fontWeight: "600" as const,
      color: colors.foregroundMuted,
      paddingHorizontal: 6,
      paddingTop: 10,
      paddingBottom: 4,
      letterSpacing: 0.3,
    },
    treeFile: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingVertical: 3,
      paddingHorizontal: 6,
      borderRadius: 5,
    },
    treeFileActive: { backgroundColor: colors.surface2 },
    treeName: { flex: 1, fontSize: 12, color: colors.foreground },
    treeNameViewed: { color: colors.foregroundMuted, opacity: 0.6 },
    treeStat: { fontSize: 11, color: colors.foregroundMuted },
    main: { flex: 1, minWidth: 0 },
    header: {
      paddingHorizontal: 18,
      paddingVertical: 12,
      gap: 4,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    title: { fontSize: 15, fontWeight: "600" as const, color: colors.foreground },
    meta: { fontSize: 12, color: colors.foregroundMuted },
    list: { paddingHorizontal: 18, paddingBottom: 40 },
    groupRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingTop: 18,
      paddingBottom: 8,
    },
    groupLabel: { fontSize: 12, fontWeight: "600" as const, color: colors.foregroundMuted },
    link: { fontSize: 12, color: colors.accent },
    fileHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    },
    fileHeaderCollapsed: { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
    chevron: { fontSize: 11, color: colors.foregroundMuted, width: 12 },
    filePath: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      color: colors.foreground,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    fileDir: { color: colors.foregroundMuted },
    added: { fontSize: 12, color: "#3fb950", fontWeight: "600" as const },
    removed: { fontSize: 12, color: "#f85149", fontWeight: "600" as const },
    changed: { fontSize: 10, fontWeight: "600" as const, color: colors.statusWarning },
    viewedToggle: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: colors.border,
    },
    viewedBox: {
      width: 12,
      height: 12,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: colors.foregroundMuted,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    viewedBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    viewedTick: { fontSize: 9, lineHeight: 10, color: colors.accentForeground },
    viewedLabel: { fontSize: 11, color: colors.foregroundMuted },
    body: {
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.border,
      overflow: "hidden" as const,
    },
    status: {
      fontSize: 12,
      color: colors.foregroundMuted,
      padding: 12,
      borderWidth: 1,
      borderTopWidth: 0,
      borderColor: colors.border,
    },
    center: {
      flex: 1,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      padding: 20,
    },
    note: { fontSize: 13, color: colors.foregroundMuted, textAlign: "center" as const },
    error: { fontSize: 13, color: colors.statusDanger },
  };
}
type Styles = ReturnType<typeof createStyles>;

function useReviewFiles(repo: string, number: number) {
  const load = useRpc(getReviewFiles);
  return useQuery({
    queryKey: reviewKeys.files(repo, number),
    queryFn: () => load({ repo, number }),
    refetchInterval: 120_000,
  });
}

/** Ticks files in the view at once, then on GitHub; a refusal puts the marks back. */
function useSetViewed(repo: string, number: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useRpc(setFilesViewed);
  const key = reviewKeys.files(repo, number);
  return useMutation({
    mutationFn: ({ paths, viewed }: { paths: string[]; viewed: boolean }) =>
      save({ repo, number, paths, viewed }),
    onMutate: async ({ paths, viewed }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<FilesResult>(key);
      const marked = new Set(paths);
      queryClient.setQueryData<FilesResult>(
        key,
        (data) =>
          data && {
            ...data,
            files: data.files.map((file) =>
              marked.has(file.path) ? { ...file, viewed: viewed ? "VIEWED" : "UNVIEWED" } : file,
            ),
          },
      );
      return { before };
    },
    onError: (error, _input, context) => {
      if (context?.before) queryClient.setQueryData(key, context.before);
      toast.error(`GitHub didn't save that: ${error.message}`);
    },
  });
}

/** Every open group's diffs, fetched together per group and parsed once. */
function useGroupDiffs(
  repo: string,
  number: number,
  data: FilesResult | undefined,
  openGroups: ReadonlySet<FileGroup>,
) {
  const load = useRpc(getFileDiffs);
  const groups = FILE_GROUPS.filter((group) => openGroups.has(group));
  const results = useQueries({
    queries: groups.map((group) => {
      const paths = (data?.files ?? [])
        .filter((file) => file.group === group)
        .map((file) => file.path);
      return {
        queryKey: reviewKeys.diffs(repo, number, data?.headSha ?? "", group),
        enabled: Boolean(data) && paths.length > 0,
        staleTime: Infinity,
        queryFn: async (): Promise<Diffs> => {
          const diffs: Diffs = {};
          for (let start = 0; start < paths.length; start += DIFF_BATCH) {
            Object.assign(
              diffs,
              (await load({ repo, number, paths: paths.slice(start, start + DIFF_BATCH) })).diffs,
            );
          }
          return diffs;
        },
      };
    }),
  });
  const parsed = useMemo(() => {
    const byPath = new Map<string, { lines: DiffLine[]; truncated: boolean }>();
    for (const result of results)
      for (const [path, { diff, truncated }] of Object.entries(result.data ?? {}))
        byPath.set(path, { lines: parseDiff(diff), truncated });
    return byPath;
    // Each query's data object only changes when that group's diffs do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((result) => result.dataUpdatedAt).join(",")]);
  const pending = new Set(groups.filter((_group, index) => results[index]?.isPending));
  const errors = results.map((result) => result.error?.message).filter(Boolean);
  return { parsed, pending, errors };
}

function ViewedToggle({
  viewed,
  styles,
  onToggle,
}: {
  viewed: boolean;
  styles: Styles;
  onToggle(): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: viewed }}
      onPress={onToggle}
      style={styles.viewedToggle}
    >
      <View style={[styles.viewedBox, viewed && styles.viewedBoxOn]}>
        {viewed ? <Text style={styles.viewedTick}>✓</Text> : null}
      </View>
      <Text style={styles.viewedLabel}>Viewed</Text>
    </Pressable>
  );
}

function FileHeader({
  file,
  expanded,
  prUrl,
  styles,
  onToggleExpanded,
  onToggleViewed,
}: {
  file: ReviewFile;
  expanded: boolean;
  prUrl: string;
  styles: Styles;
  onToggleExpanded(): void;
  onToggleViewed(): void;
}) {
  const dir = dirName(file.path);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onToggleExpanded}
      style={[styles.fileHeader, !expanded && styles.fileHeaderCollapsed]}
    >
      <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
      <Text style={styles.filePath} numberOfLines={1}>
        {dir ? <Text style={styles.fileDir}>{dir}/</Text> : null}
        {baseName(file.path)}
      </Text>
      {file.viewed === "DISMISSED" ? (
        <Text style={styles.changed}>CHANGED SINCE VIEWED</Text>
      ) : null}
      <Text style={styles.added}>+{file.additions}</Text>
      <Text style={styles.removed}>−{file.deletions}</Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void githubFileUrl(prUrl, file.path).then(openExternalUrl)}
      >
        <Text style={styles.viewedLabel}>GitHub</Text>
      </Pressable>
      <ViewedToggle viewed={isViewed(file)} styles={styles} onToggle={onToggleViewed} />
    </Pressable>
  );
}

function FileTree({
  data,
  openGroups,
  activePath,
  styles,
  onJump,
}: {
  data: FilesResult;
  openGroups: ReadonlySet<FileGroup>;
  activePath: string | null;
  styles: Styles;
  onJump(file: ReviewFile): void;
}) {
  return (
    <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent}>
      {FILE_GROUPS.map((group) => {
        const files = data.files.filter((file) => file.group === group);
        if (!files.length) return null;
        return (
          <View key={group}>
            <Text style={styles.treeGroup}>
              {FILE_GROUP_LABELS[group].toUpperCase()} · {files.length}
              {openGroups.has(group) ? "" : " · folded"}
            </Text>
            {files.map((file) => (
              <Pressable
                key={file.path}
                accessibilityRole="button"
                onPress={() => onJump(file)}
                style={[styles.treeFile, file.path === activePath && styles.treeFileActive]}
              >
                <Text
                  style={[styles.treeName, isViewed(file) && styles.treeNameViewed]}
                  numberOfLines={1}
                >
                  {baseName(file.path)}
                </Text>
                <Text style={styles.treeStat}>{file.additions + file.deletions}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

export function ReviewScreen(props: PluginScreenProps) {
  const repo = props.params.repo ?? "";
  const number = Number(props.params.number);
  const styles = useMemo(
    () => createStyles(props.theme, props.layout.compact),
    [props.theme, props.layout.compact],
  );
  const diffStyles: DiffStyles = useMemo(() => createDiffStyles(props.theme), [props.theme]);
  const { data, error, isPending } = useReviewFiles(repo, number);
  const setViewed = useSetViewed(repo, number);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<FileGroup>>(OPEN_BY_DEFAULT);
  // Files you expanded or collapsed by hand; the rest follow GitHub: viewed files start folded.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [activePath, setActivePath] = useState<string | null>(null);
  const listRef = useRef<NativeFlatList<Row>>(null);
  const diffs = useGroupDiffs(repo, number, data, openGroups);

  const isExpanded = useCallback(
    (file: ReviewFile) => overrides.get(file.path) ?? !isViewed(file),
    [overrides],
  );

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const group of FILE_GROUPS) {
      const files = data.files.filter((file) => file.group === group);
      if (!files.length) continue;
      const open = openGroups.has(group);
      out.push({ kind: "group", key: `group:${group}`, group, files, open });
      if (!open) continue;
      for (const file of files) {
        const expanded = isExpanded(file);
        out.push({ kind: "file", key: `file:${file.path}`, file, expanded });
        if (!expanded) continue;
        const diff = diffs.parsed.get(file.path);
        if (!diff) {
          out.push({
            kind: "status",
            key: `status:${file.path}`,
            text: diffs.pending.has(group) ? "Loading diff…" : "No diff for this file.",
          });
          continue;
        }
        diff.lines.forEach((line, index) =>
          out.push({ kind: "line", key: `line:${file.path}:${index}`, line }),
        );
        if (diff.truncated)
          out.push({
            kind: "status",
            key: `cut:${file.path}`,
            text: "This diff is over 2 MB, so only the start is shown.",
          });
      }
    }
    return out;
  }, [data, openGroups, isExpanded, diffs.parsed, diffs.pending]);

  const toggleViewed = (file: ReviewFile) => {
    const viewed = !isViewed(file);
    // Like GitHub: marking a file viewed folds it, unmarking opens it.
    setOverrides((current) => new Map(current).set(file.path, !viewed));
    setViewed.mutate({ paths: [file.path], viewed });
  };

  const jumpTo = (file: ReviewFile) => {
    if (!openGroups.has(file.group)) setOpenGroups(new Set([...openGroups, file.group]));
    setOverrides((current) => new Map(current).set(file.path, true));
    setActivePath(file.path);
    // The row may not exist until the group opens, so look it up after the next render. Wrapped
    // lines make row heights unknown until rendered, so a second pass settles on the exact spot.
    const scroll = () => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === "file" && row.file.path === file.path,
      );
      if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
    };
    setTimeout(scroll, 0);
    setTimeout(scroll, 150);
  };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems
      .map((token) => token.item as Row)
      .find((row) => row.kind === "file" || row.kind === "line");
    if (first?.kind === "file") setActivePath(first.file.path);
    else if (first?.kind === "line") setActivePath(first.key.slice(5, first.key.lastIndexOf(":")));
  }).current;

  if (!repo || !Number.isInteger(number))
    return (
      <Text style={[styles.error, { padding: 20 }]}>
        Open this from the PR inbox or with /review-files.
      </Text>
    );
  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.note}>
          Loading {repo}#{number}…
        </Text>
      </View>
    );
  }
  if (!data)
    return (
      <Text style={[styles.error, { padding: 20 }]}>
        {error?.message ?? "Couldn't load the PR."}
      </Text>
    );

  const viewedCount = data.files.filter(isViewed).length;
  const additions = data.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = data.files.reduce((sum, file) => sum + file.deletions, 0);

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case "group": {
        const unviewed = item.files.filter((file) => !isViewed(file)).map((file) => file.path);
        const lines = item.files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
        return (
          <View style={styles.groupRow}>
            <Text style={styles.groupLabel}>
              {FILE_GROUP_LABELS[item.group]} · {item.files.length} files · {lines.toLocaleString()}{" "}
              lines
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setOpenGroups(
                  item.open
                    ? new Set([...openGroups].filter((group) => group !== item.group))
                    : new Set([...openGroups, item.group]),
                )
              }
            >
              <Text style={styles.link}>{item.open ? "Fold" : "Show"}</Text>
            </Pressable>
            {unviewed.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setViewed.mutate({ paths: unviewed, viewed: true })}
              >
                <Text style={styles.link}>Mark all viewed</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }
      case "file":
        return (
          <FileHeader
            file={item.file}
            expanded={item.expanded}
            prUrl={data.url}
            styles={styles}
            onToggleExpanded={() =>
              setOverrides((current) => new Map(current).set(item.file.path, !item.expanded))
            }
            onToggleViewed={() => toggleViewed(item.file)}
          />
        );
      case "line":
        return (
          <View style={styles.body}>
            <DiffLineRow line={item.line} styles={diffStyles} />
          </View>
        );
      case "status":
        return <Text style={styles.status}>{item.text}</Text>;
    }
  };

  return (
    <View style={styles.root}>
      <FileTree
        data={data}
        openGroups={openGroups}
        activePath={activePath}
        styles={styles}
        onJump={jumpTo}
      />
      <View style={styles.main}>
        <View style={styles.header}>
          <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(data.url)}>
            <Text style={styles.title}>{data.title}</Text>
          </Pressable>
          <Text style={styles.meta}>
            {repo}#{number} · {data.author} · {data.files.length} files{" "}
            <Text style={styles.added}>+{additions.toLocaleString()}</Text>{" "}
            <Text style={styles.removed}>−{deletions.toLocaleString()}</Text> · {viewedCount} viewed
          </Text>
          {diffs.errors.length ? <Text style={styles.error}>{diffs.errors[0]}</Text> : null}
        </View>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          initialNumToRender={60}
          windowSize={21}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
          // Lines wrap, so heights aren't known up front: jump near, then settle on the row.
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(
              () => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 }),
              60,
            );
          }}
        />
      </View>
    </View>
  );
}
