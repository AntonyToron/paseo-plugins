import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { FlatList, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type FlatList as NativeFlatList,
  type ViewToken,
} from "react-native";
import {
  FILE_GROUPS,
  FILE_GROUP_LABELS,
  getFileDiffs,
  getFileSort,
  getReviewFiles,
  githubFileUrl,
  parseDiff,
  setFilesViewed,
  SORT_TIER_LABELS,
  SORT_TIERS,
  type DiffLine,
  type FileGroup,
  type ReviewFile,
  type SortedFile,
} from "../shared/review";
import { decorateFile } from "./decorate";
import { createDiffStyles, DiffLineRow, type DiffStyles } from "./diff-view";
import { anchorKey, type CommentAnchor, type PendingComment } from "../shared/comments";
import {
  CommentCard,
  CommentComposer,
  createCommentStyles,
  SendDialog,
  useComments,
  useDeleteComment,
  useSaveComment,
} from "./comments";
import { FileTree } from "./file-tree";
import { HoverPressable } from "./hover";
import { useRowMetrics } from "./row-metrics";

const reviewKeys = {
  files: (repo: string, number: number) => ["paseo-review", repo, number, "files"] as const,
  diffs: (repo: string, number: number, headSha: string, group: FileGroup) =>
    ["paseo-review", repo, number, headSha, "diffs", group] as const,
  sort: (repo: string, number: number, headSha: string) =>
    ["paseo-review", repo, number, headSha, "sort"] as const,
};

// Big groups are fetched in a few calls rather than one huge one.
const DIFF_BATCH = 60;
const SORT_POLL_MS = 3_000;
const NO_SORT: SortedFile[] = [];
const NO_COMMENTS: PendingComment[] = [];
const JUMP_SETTLE_MS = [0, 120, 300, 600];
// Estimates for rows not drawn yet; drawn rows use their measured height. Code is 12px monospace
// with a 20px line height, so a line's wrapped height follows from its length.
const CHAR_WIDTH = 7.22;
const LINE_HEIGHT = 20;
// List padding, body borders, both line-number columns, the sign and the code's right padding.
const CODE_INSET = 36 + 2 + 96 + 18 + 16;
const TAB_WIDTH = 8;

function estimateRowHeight(row: Row, codeWidth: number): number {
  switch (row.kind) {
    case "section":
      return 40;
    case "file":
      return row.summary ? 62 : 46;
    case "status":
      return 41;
    case "comment":
      return 64 + LINE_HEIGHT * Math.ceil(row.comment.body.length / 90);
    case "composer":
      return 150;
    case "line": {
      if (row.line.kind === "hunk") return LINE_HEIGHT;
      if (row.line.kind === "meta") return 24;
      const columns = Math.max(20, Math.floor(codeWidth / CHAR_WIDTH));
      const length = row.line.text.replaceAll("\t", " ".repeat(TAB_WIDTH)).length;
      return LINE_HEIGHT * Math.max(1, Math.ceil(length / columns));
    }
  }
}

type FilesResult = RpcOutput<typeof getReviewFiles>;
// While marks are on their way to GitHub, poll to show progress.
const MARKING_POLL_MS = 3_000;
type Diffs = Record<string, { diff: string; truncated: boolean }>;

/** A run of files under one heading in the scroll and the tree. */
interface Section {
  id: string;
  label: string;
  group: FileGroup;
  files: ReviewFile[];
  openByDefault: boolean;
}

/**
 * Source files split into Claude's Core, Supporting and Trivial, in its reading order, once its
 * sort is in; until then they're one Source section in path order. Trivial files, tests and
 * generated files start folded: they're most of a big PR's lines and the least of its meaning.
 */
function buildSections(files: readonly ReviewFile[], sorted: readonly SortedFile[]): Section[] {
  const byGroup = (group: FileGroup) => files.filter((file) => file.group === group);
  const plain = (group: FileGroup): Section => ({
    id: group,
    label: FILE_GROUP_LABELS[group],
    group,
    files: byGroup(group),
    openByDefault: group === "source" || group === "config",
  });
  const sources = byGroup("source");
  const sourceSections: Section[] = sorted.length
    ? SORT_TIERS.map((tier) => ({
        id: tier,
        label: SORT_TIER_LABELS[tier],
        group: "source" as const,
        files: sorted
          .filter((entry) => entry.tier === tier)
          .map((entry) => sources.find((file) => file.path === entry.path))
          .filter((file): file is ReviewFile => Boolean(file)),
        openByDefault: tier !== "trivial",
      }))
    : [plain("source")];
  return [
    ...sourceSections,
    ...FILE_GROUPS.filter((group) => group !== "source").map(plain),
  ].filter((section) => section.files.length > 0);
}

type Row =
  | { kind: "section"; key: string; section: Section; open: boolean }
  | { kind: "file"; key: string; file: ReviewFile; expanded: boolean; summary: string | null }
  | {
      kind: "line";
      key: string;
      line: DiffLine;
      path: string;
      fileLines: readonly DiffLine[];
      index: number;
      anchor: CommentAnchor | null;
    }
  | { kind: "comment"; key: string; comment: PendingComment }
  | { kind: "composer"; key: string; anchor: CommentAnchor; editing: PendingComment | null }
  | { kind: "status"; key: string; text: string };

const isViewed = (file: ReviewFile) => file.viewed === "VIEWED";

/** Where a comment on this line would sit: removed lines by their old number, the rest by their new one. */
function lineAnchor(path: string, line: DiffLine): CommentAnchor | null {
  if (line.kind === "remove" && line.oldLine !== null)
    return { path, side: "old", line: line.oldLine, lineText: line.text };
  if ((line.kind === "add" || line.kind === "context") && line.newLine !== null)
    return { path, side: "new", line: line.newLine, lineText: line.text };
  return null;
}

const SKIPPED_NAMES: Record<string, string> = {
  trivial: "trivial",
  tests: "test",
  generated: "generated",
};
const listWords = (words: readonly string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");
const baseName = (path: string) => path.split("/").at(-1) ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");

function createStyles({ colors }: PluginTheme, compact: boolean) {
  return {
    root: {
      flex: 1,
      flexDirection: compact ? ("column" as const) : ("row" as const),
      backgroundColor: colors.surface0,
    },
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
    linkHovered: { textDecorationLine: "underline" as const },
    headerActions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 12,
      marginTop: 4,
    },
    sendButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
    sendButtonHovered: { opacity: 0.88 },
    sendLabel: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
    fileHeaderHovered: { backgroundColor: colors.surface2 },
    chip: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: "transparent",
    },
    chipHovered: { borderColor: colors.border, backgroundColor: colors.surface1 },
    commentCount: {
      fontSize: 11,
      fontWeight: "600" as const,
      color: colors.statusWarning,
    },
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
    fileTitle: { flex: 1, minWidth: 0, gap: 2 },
    summary: { fontSize: 12, color: colors.foregroundMuted },
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
    refetchInterval: (query) => (query.state.data?.marking ? MARKING_POLL_MS : 120_000),
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
    // Picks up the queue's progress, which also starts the faster polling.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Claude's reading order for the source files, polled while it works. */
function useFileSort(repo: string, number: number, headSha: string | undefined) {
  const load = useRpc(getFileSort);
  return useQuery({
    queryKey: reviewKeys.sort(repo, number, headSha ?? ""),
    queryFn: () => load({ repo, number }),
    enabled: Boolean(headSha),
    refetchInterval: (query) => (query.state.data?.status === "running" ? SORT_POLL_MS : false),
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
    <HoverPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: viewed }}
      onPress={onToggle}
      style={({ hovered }) => [styles.viewedToggle, hovered && styles.chipHovered]}
    >
      <View style={[styles.viewedBox, viewed && styles.viewedBoxOn]}>
        {viewed ? <Text style={styles.viewedTick}>✓</Text> : null}
      </View>
      <Text style={styles.viewedLabel}>Viewed</Text>
    </HoverPressable>
  );
}

function FileHeader({
  file,
  summary,
  expanded,
  prUrl,
  commentCount,
  styles,
  onToggleExpanded,
  onToggleViewed,
}: {
  file: ReviewFile;
  summary: string | null;
  expanded: boolean;
  prUrl: string;
  commentCount: number;
  styles: Styles;
  onToggleExpanded(): void;
  onToggleViewed(): void;
}) {
  const dir = dirName(file.path);
  return (
    <HoverPressable
      accessibilityRole="button"
      onPress={onToggleExpanded}
      style={({ hovered }) => [
        styles.fileHeader,
        hovered && styles.fileHeaderHovered,
        !expanded && styles.fileHeaderCollapsed,
      ]}
    >
      <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>
      <View style={styles.fileTitle}>
        <Text style={styles.filePath} numberOfLines={1}>
          {dir ? <Text style={styles.fileDir}>{dir}/</Text> : null}
          {baseName(file.path)}
        </Text>
        {summary ? (
          <Text style={styles.summary} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
      {file.viewed === "DISMISSED" ? (
        <Text style={styles.changed}>CHANGED SINCE VIEWED</Text>
      ) : null}
      {commentCount ? (
        <Text style={styles.commentCount}>
          {commentCount} {commentCount === 1 ? "comment" : "comments"}
        </Text>
      ) : null}
      <Text style={styles.added}>+{file.additions}</Text>
      <Text style={styles.removed}>−{file.deletions}</Text>
      <HoverPressable
        accessibilityRole="link"
        onPress={() => void githubFileUrl(prUrl, file.path).then(openExternalUrl)}
        style={({ hovered }) => [styles.chip, hovered && styles.chipHovered]}
      >
        <Text style={styles.viewedLabel}>GitHub</Text>
      </HoverPressable>
      <ViewedToggle viewed={isViewed(file)} styles={styles} onToggle={onToggleViewed} />
    </HoverPressable>
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
  const sort = useFileSort(repo, number, data?.headSha);
  // Sections you showed or folded by hand; the rest keep their default.
  const [sectionOverrides, setSectionOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  // Files you expanded or collapsed by hand; the rest follow GitHub: viewed files start folded.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [activePath, setActivePath] = useState<string | null>(null);
  const listRef = useRef<NativeFlatList<Row>>(null);
  const toast = useToast();
  const commentStyles = useMemo(() => createCommentStyles(props.theme), [props.theme]);
  const comments = useComments(repo, number);
  const saveComment = useSaveComment(repo, number);
  const deleteComment = useDeleteComment(repo, number);
  // The comment being written or edited: where it goes, and its text so far.
  const [draft, setDraft] = useState<{
    anchor: CommentAnchor;
    editing: PendingComment | null;
    body: string;
  } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const pendingComments = comments.data?.comments ?? NO_COMMENTS;
  const commentsByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of pendingComments)
      counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    return counts;
  }, [pendingComments]);
  const commentsAt = useMemo(() => {
    const byAnchor = new Map<string, PendingComment[]>();
    for (const comment of pendingComments)
      byAnchor.set(anchorKey(comment), [...(byAnchor.get(anchorKey(comment)) ?? []), comment]);
    return byAnchor;
  }, [pendingComments]);

  const sorted = sort.data?.status === "ready" ? sort.data.files : NO_SORT;
  const sections = useMemo(() => buildSections(data?.files ?? [], sorted), [data, sorted]);
  const summaries = useMemo(
    () => new Map(sorted.map((entry) => [entry.path, entry.summary])),
    [sorted],
  );
  const isOpen = useCallback(
    (section: Section) => sectionOverrides.get(section.id) ?? section.openByDefault,
    [sectionOverrides],
  );
  const treeSections = useMemo(
    () => sections.map((section) => ({ ...section, open: isOpen(section) })),
    [sections, isOpen],
  );
  const openGroups = useMemo(
    () => new Set(sections.filter(isOpen).map((section) => section.group)),
    [sections, isOpen],
  );
  const diffs = useGroupDiffs(repo, number, data, openGroups);

  const isExpanded = useCallback(
    (file: ReviewFile) => overrides.get(file.path) ?? !isViewed(file),
    [overrides],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const section of sections) {
      const open = isOpen(section);
      out.push({ kind: "section", key: `section:${section.id}`, section, open });
      if (!open) continue;
      for (const file of section.files) {
        const expanded = isExpanded(file);
        const summary = summaries.get(file.path) || null;
        out.push({ kind: "file", key: `file:${file.path}`, file, expanded, summary });
        if (!expanded) continue;
        const diff = diffs.parsed.get(file.path);
        if (!diff) {
          out.push({
            kind: "status",
            key: `status:${file.path}`,
            text: diffs.pending.has(file.group) ? "Loading diff…" : "No diff for this file.",
          });
          continue;
        }
        diff.lines.forEach((line, index) => {
          const anchor = lineAnchor(file.path, line);
          out.push({
            kind: "line",
            key: `line:${file.path}:${index}`,
            line,
            path: file.path,
            fileLines: diff.lines,
            index,
            anchor,
          });
          if (!anchor) return;
          const at = anchorKey(anchor);
          for (const comment of commentsAt.get(at) ?? [])
            out.push(
              draft?.editing?.id === comment.id
                ? { kind: "composer", key: `composer:${comment.id}`, anchor, editing: comment }
                : { kind: "comment", key: `comment:${comment.id}`, comment },
            );
          if (draft && !draft.editing && anchorKey(draft.anchor) === at)
            out.push({ kind: "composer", key: `composer:${at}`, anchor, editing: null });
        });
        if (diff.truncated)
          out.push({
            kind: "status",
            key: `cut:${file.path}`,
            text: "This diff is over 2 MB, so only the start is shown.",
          });
      }
    }
    return out;
    // The draft's text isn't a dependency: typing shouldn't rebuild every row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sections,
    isOpen,
    isExpanded,
    summaries,
    diffs.parsed,
    diffs.pending,
    commentsAt,
    draft?.anchor,
    draft?.editing,
  ]);

  const [listWidth, setListWidth] = useState(0);
  const estimate = useCallback(
    (row: Row) => estimateRowHeight(row, listWidth - CODE_INSET),
    [listWidth],
  );
  const metrics = useRowMetrics(rows, estimate);

  const toggleViewed = (file: ReviewFile) => {
    const viewed = !isViewed(file);
    // Like GitHub: marking a file viewed folds it, unmarking opens it.
    setOverrides((current) => new Map(current).set(file.path, !viewed));
    setViewed.mutate({ paths: [file.path], viewed });
  };

  const jumpTo = (file: ReviewFile) => {
    const section = sections.find((candidate) => candidate.files.includes(file));
    if (section && !isOpen(section))
      setSectionOverrides((current) => new Map(current).set(section.id, true));
    setOverrides((current) => new Map(current).set(file.path, true));
    setActivePath(file.path);
    // The first scroll lands on estimated heights; the rows it draws get measured, and the later
    // scrolls settle on the exact spot. The row may not exist until its section opens.
    const scroll = () => {
      const index = rowsRef.current.findIndex((row) => row.key === `file:${file.path}`);
      if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
    };
    for (const delay of JUMP_SETTLE_MS) setTimeout(scroll, delay);
  };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems
      .map((token) => token.item as Row)
      .find((row) => row.kind === "file" || row.kind === "line");
    if (first?.kind === "file") setActivePath(first.file.path);
    else if (first?.kind === "line") setActivePath(first.path);
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
  const hasSources = data.files.some((file) => file.group === "source");
  const sortNote = !hasSources
    ? null
    : sort.error || sort.data?.status === "failed"
      ? `Couldn't sort the files into a reading order: ${sort.error?.message ?? sort.data?.error}`
      : sort.data?.status !== "ready"
        ? "Claude is sorting the source files into a reading order…"
        : null;
  // The sections that start folded are the ones you skip reading; one press ticks them on GitHub.
  const skipped = sections.filter((section) => !section.openByDefault);
  const skippedUnviewed = skipped
    .flatMap((section) => section.files)
    .filter((file) => !isViewed(file))
    .map((file) => file.path);

  const renderRow = ({ item }: { item: Row }) => (
    <View onLayout={(event) => metrics.onRowLayout(item.key, event.nativeEvent.layout.height)}>
      {renderRowContent(item)}
    </View>
  );

  const renderRowContent = (item: Row) => {
    switch (item.kind) {
      case "section": {
        const { files } = item.section;
        const unviewed = files.filter((file) => !isViewed(file)).map((file) => file.path);
        const lines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
        return (
          <View style={styles.groupRow}>
            <Text style={styles.groupLabel}>
              {item.section.label} · {files.length} files · {lines.toLocaleString()} lines
            </Text>
            <HoverPressable
              accessibilityRole="button"
              onPress={() =>
                setSectionOverrides((current) => new Map(current).set(item.section.id, !item.open))
              }
            >
              {({ hovered }) => (
                <Text style={[styles.link, hovered && styles.linkHovered]}>
                  {item.open ? "Fold" : "Show"}
                </Text>
              )}
            </HoverPressable>
            {unviewed.length ? (
              <HoverPressable
                accessibilityRole="button"
                onPress={() => setViewed.mutate({ paths: unviewed, viewed: true })}
              >
                {({ hovered }) => (
                  <Text style={[styles.link, hovered && styles.linkHovered]}>Mark all viewed</Text>
                )}
              </HoverPressable>
            ) : null}
          </View>
        );
      }
      case "file":
        return (
          <FileHeader
            file={item.file}
            summary={item.summary}
            expanded={item.expanded}
            prUrl={data.url}
            commentCount={commentsByFile.get(item.file.path) ?? 0}
            styles={styles}
            onToggleExpanded={() =>
              setOverrides((current) => new Map(current).set(item.file.path, !item.expanded))
            }
            onToggleViewed={() => toggleViewed(item.file)}
          />
        );
      case "line": {
        const { anchor } = item;
        return (
          <View style={styles.body}>
            <DiffLineRow
              line={item.line}
              segments={decorateFile(item.fileLines, item.path)[item.index] ?? null}
              styles={diffStyles}
              onComment={anchor ? () => setDraft({ anchor, editing: null, body: "" }) : undefined}
            />
          </View>
        );
      }
      case "comment":
        return (
          <View style={styles.body}>
            <CommentCard
              comment={item.comment}
              styles={commentStyles}
              onEdit={() =>
                setDraft({ anchor: item.comment, editing: item.comment, body: item.comment.body })
              }
              onDelete={() => deleteComment.mutate(item.comment.id)}
            />
          </View>
        );
      case "composer":
        return (
          <View style={styles.body}>
            <CommentComposer
              body={draft?.body ?? ""}
              editing={Boolean(item.editing)}
              saving={saveComment.isPending}
              styles={commentStyles}
              onChangeBody={(body) => setDraft((current) => current && { ...current, body })}
              onCancel={() => setDraft(null)}
              onSave={(body) =>
                saveComment.mutate(
                  { id: item.editing?.id ?? null, anchor: item.anchor, body },
                  { onSuccess: () => setDraft(null) },
                )
              }
            />
          </View>
        );
      case "status":
        return <Text style={styles.status}>{item.text}</Text>;
    }
  };

  return (
    <View style={styles.root}>
      <FileTree
        sections={treeSections}
        sorted={sorted.length > 0}
        activePath={activePath}
        commentCounts={commentsByFile}
        theme={props.theme}
        compact={props.layout.compact}
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
          <View style={styles.headerActions}>
            {skippedUnviewed.length ? (
              <HoverPressable
                accessibilityRole="button"
                disabled={setViewed.isPending}
                onPress={() => setViewed.mutate({ paths: skippedUnviewed, viewed: true })}
              >
                {({ hovered }) => (
                  <Text style={[styles.link, hovered && styles.linkHovered]}>
                    Mark{" "}
                    {listWords(skipped.map((section) => SKIPPED_NAMES[section.id] ?? section.id))}{" "}
                    files viewed on GitHub ({skippedUnviewed.length})
                  </Text>
                )}
              </HoverPressable>
            ) : (
              <View />
            )}
            {pendingComments.length ? (
              <HoverPressable
                accessibilityRole="button"
                onPress={() => setSendOpen(true)}
                style={({ hovered }) => [styles.sendButton, hovered && styles.sendButtonHovered]}
              >
                <Text style={styles.sendLabel}>
                  Send {pendingComments.length} pending{" "}
                  {pendingComments.length === 1 ? "comment" : "comments"}
                </Text>
              </HoverPressable>
            ) : (
              <Text style={styles.meta}>Click a line number to leave a comment for a chat.</Text>
            )}
          </View>
          {data.marking ? (
            <Text style={styles.meta}>
              Saving Viewed marks to GitHub, {data.marking} to go. GitHub takes a second or two per
              file.
            </Text>
          ) : null}
          {data.markError ? (
            <Text style={styles.error}>
              GitHub didn't save some Viewed marks ({data.markError}); those files show GitHub's
              state again.
            </Text>
          ) : null}
          {sortNote ? <Text style={styles.meta}>{sortNote}</Text> : null}
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
          getItemLayout={metrics.getItemLayout}
          onLayout={(event) => {
            const width = Math.round(event.nativeEvent.layout.width);
            if (width === listWidth) return;
            metrics.forgetMeasured();
            setListWidth(width);
          }}
        />
      </View>
      <SendDialog
        repo={repo}
        number={number}
        url={data.url}
        title={data.title}
        comments={pendingComments}
        open={sendOpen}
        styles={commentStyles}
        onClose={() => setSendOpen(false)}
        onSent={(agentId, sent) => {
          setSendOpen(false);
          toast.show(`Sent ${sent} ${sent === 1 ? "comment" : "comments"} to the chat.`, {
            variant: "success",
          });
          props.navigation?.openAgent({ agentId });
        }}
      />
    </View>
  );
}
