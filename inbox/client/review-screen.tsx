import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  FILE_GROUPS,
  FILE_GROUP_LABELS,
  getFileDiff,
  getReviewFiles,
  githubFileUrl,
  setFilesViewed,
  type FileGroup,
  type ReviewFile,
} from "../shared/review";
import { DiffView } from "./diff-view";

const reviewKeys = {
  files: (repo: string, number: number) => ["paseo-review", repo, number, "files"] as const,
  diff: (repo: string, number: number, headSha: string, path: string) =>
    ["paseo-review", repo, number, headSha, "diff", path] as const,
};

type Styles = ReturnType<typeof createStyles>;
type FilesResult = {
  title: string;
  url: string;
  author: string;
  headSha: string;
  files: ReviewFile[];
};

function createStyles({ colors }: PluginTheme, compact: boolean) {
  return {
    root: {
      flex: 1,
      flexDirection: compact ? ("column" as const) : ("row" as const),
      backgroundColor: colors.surface0,
    },
    // A ScrollView flexes to fill a row by default, which split the screen in half; pin the list.
    sidebar: {
      width: compact ? ("100%" as const) : 380,
      flexGrow: 0,
      flexShrink: 0,
      maxHeight: compact ? 320 : undefined,
      borderRightWidth: compact ? 0 : 1,
      borderBottomWidth: compact ? 1 : 0,
      borderColor: colors.border,
    },
    sidebarContent: { padding: 12, gap: 10 },
    title: { fontSize: 14, fontWeight: "600" as const, color: colors.foreground },
    meta: { fontSize: 12, color: colors.foregroundMuted },
    toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    group: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 6,
      gap: 2,
    },
    groupHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    groupLabel: { fontSize: 13, fontWeight: "600" as const, color: colors.foreground },
    groupCount: { fontSize: 11, color: colors.foregroundMuted },
    spacer: { flex: 1 },
    file: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderRadius: 6,
    },
    fileSelected: { backgroundColor: colors.surface2 },
    checkbox: {
      width: 15,
      height: 15,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.foregroundMuted,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    check: {
      fontSize: 10,
      lineHeight: 11,
      color: colors.accentForeground,
      fontWeight: "700" as const,
    },
    fileText: { flex: 1, minWidth: 0 },
    fileName: { fontSize: 13, color: colors.foreground },
    fileNameViewed: { color: colors.foregroundMuted },
    fileDir: { fontSize: 11, color: colors.foregroundMuted },
    stat: { fontSize: 11, color: colors.foregroundMuted },
    changed: { fontSize: 10, color: colors.statusWarning, fontWeight: "600" as const },
    button: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: colors.surface2,
    },
    buttonText: { fontSize: 12, color: colors.foreground },
    primaryButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: colors.accent,
    },
    primaryText: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
    main: { flex: 1, minWidth: 0 },
    diffHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    diffPath: {
      flex: 1,
      fontSize: 13,
      color: colors.foreground,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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

const baseName = (path: string) => path.split("/").at(-1) ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");
const isViewed = (file: ReviewFile) => file.viewed === "VIEWED";

function useReviewFiles(repo: string, number: number) {
  const load = useRpc(getReviewFiles);
  return useQuery({
    queryKey: reviewKeys.files(repo, number),
    queryFn: () => load({ repo, number }),
    refetchInterval: 120_000,
  });
}

/** Marks files viewed in the list straight away, then on GitHub; a refusal puts the marks back. */
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

function Checkbox({ on, styles, onToggle }: { on: boolean; styles: Styles; onToggle(): void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onToggle}
      hitSlop={6}
    >
      <View style={[styles.checkbox, on && styles.checkboxOn]}>
        {on ? <Text style={styles.check}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

function FileRow({
  file,
  selected,
  styles,
  onSelect,
  onToggle,
}: {
  file: ReviewFile;
  selected: boolean;
  styles: Styles;
  onSelect(): void;
  onToggle(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onSelect}
      style={[styles.file, selected && styles.fileSelected]}
    >
      <Checkbox on={isViewed(file)} styles={styles} onToggle={onToggle} />
      <View style={styles.fileText}>
        <Text style={[styles.fileName, isViewed(file) && styles.fileNameViewed]} numberOfLines={1}>
          {baseName(file.path)}
        </Text>
        {dirName(file.path) ? (
          <Text style={styles.fileDir} numberOfLines={1}>
            {dirName(file.path)}
          </Text>
        ) : null}
      </View>
      {file.viewed === "DISMISSED" ? <Text style={styles.changed}>CHANGED</Text> : null}
      <Text style={styles.stat}>
        +{file.additions} −{file.deletions}
      </Text>
    </Pressable>
  );
}

function Group({
  group,
  files,
  hideViewed,
  selectedPath,
  styles,
  onSelect,
  onSetViewed,
}: {
  group: FileGroup;
  files: ReviewFile[];
  hideViewed: boolean;
  selectedPath: string | null;
  styles: Styles;
  onSelect(path: string): void;
  onSetViewed(paths: string[], viewed: boolean): void;
}) {
  // Source is what you came to read; the rest stays folded until you want it.
  const [open, setOpen] = useState(group === "source");
  if (!files.length) return null;
  const viewed = files.filter(isViewed).length;
  const lines = files.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const shown = hideViewed ? files.filter((file) => !isViewed(file)) : files;
  const unviewed = files.filter((file) => !isViewed(file)).map((file) => file.path);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(!open)}
        style={styles.groupHeader}
      >
        <Text style={styles.groupLabel}>
          {open ? "▾" : "▸"} {FILE_GROUP_LABELS[group]}
        </Text>
        <Text style={styles.groupCount}>
          {viewed}/{files.length} viewed · {lines.toLocaleString()} lines
        </Text>
        <View style={styles.spacer} />
        {unviewed.length ? (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => onSetViewed(unviewed, true)}
          >
            <Text style={styles.buttonText}>Mark viewed</Text>
          </Pressable>
        ) : null}
      </Pressable>
      {open
        ? shown.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              selected={file.path === selectedPath}
              styles={styles}
              onSelect={() => onSelect(file.path)}
              onToggle={() => onSetViewed([file.path], !isViewed(file))}
            />
          ))
        : null}
    </View>
  );
}

function Diff({
  repo,
  number,
  data,
  file,
  styles,
  theme,
  onSetViewed,
  onNext,
}: {
  repo: string;
  number: number;
  data: FilesResult;
  file: ReviewFile;
  styles: Styles;
  theme: PluginTheme;
  onSetViewed(paths: string[], viewed: boolean): void;
  onNext(): void;
}) {
  const load = useRpc(getFileDiff);
  const {
    data: diff,
    error,
    isPending,
  } = useQuery({
    queryKey: reviewKeys.diff(repo, number, data.headSha, file.path),
    queryFn: () => load({ repo, number, path: file.path }),
    staleTime: Infinity,
  });
  return (
    <View style={styles.main}>
      <View style={styles.diffHeader}>
        <Checkbox
          on={isViewed(file)}
          styles={styles}
          onToggle={() => onSetViewed([file.path], !isViewed(file))}
        />
        <Text style={styles.diffPath} numberOfLines={1}>
          {file.path}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => void githubFileUrl(data.url, file.path).then(openExternalUrl)}
        >
          <Text style={styles.buttonText}>GitHub</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => {
            if (!isViewed(file)) onSetViewed([file.path], true);
            onNext();
          }}
        >
          <Text style={styles.primaryText}>
            {isViewed(file) ? "Next unviewed" : "Viewed, next"}
          </Text>
        </Pressable>
      </View>
      {isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.note}>
            Fetching the PR into a local copy. The first file takes a few seconds; the rest are
            instant.
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error.message}</Text>
        </View>
      ) : (
        <>
          {diff?.truncated ? (
            <Text style={[styles.note, { padding: 8 }]}>
              This diff is over 2 MB, so only the start is shown.
            </Text>
          ) : null}
          <DiffView diff={diff?.diff ?? ""} theme={theme} />
        </>
      )}
    </View>
  );
}

export function ReviewScreen(props: PluginScreenProps) {
  const repo = props.params.repo ?? "";
  const number = Number(props.params.number);
  const styles = useMemo(
    () => createStyles(props.theme, props.layout.compact),
    [props.theme, props.layout.compact],
  );
  const { data, error, isPending } = useReviewFiles(repo, number);
  const setViewed = useSetViewed(repo, number);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hideViewed, setHideViewed] = useState(true);

  const grouped = useMemo(() => {
    const byGroup = new Map<FileGroup, ReviewFile[]>(FILE_GROUPS.map((group) => [group, []]));
    for (const file of data?.files ?? []) byGroup.get(file.group)?.push(file);
    return byGroup;
  }, [data]);
  // Reading order: source first, then config, tests and generated, each in path order.
  const ordered = useMemo(
    () => FILE_GROUPS.flatMap((group) => grouped.get(group) ?? []),
    [grouped],
  );

  useEffect(() => {
    if (selectedPath || !ordered.length) return;
    setSelectedPath((ordered.find((file) => !isViewed(file)) ?? ordered[0])?.path ?? null);
  }, [ordered, selectedPath]);

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
          Loading {repo}#{number}'s files…
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

  const selected = data.files.find((file) => file.path === selectedPath) ?? null;
  const viewedCount = data.files.filter(isViewed).length;
  const onSetViewed = (paths: string[], viewed: boolean) => setViewed.mutate({ paths, viewed });
  const nextUnviewed = () => {
    const start = ordered.findIndex((file) => file.path === selectedPath);
    const after = [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)];
    const next = after.find((file) => !isViewed(file) && file.path !== selectedPath);
    if (next) setSelectedPath(next.path);
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent}>
        <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(data.url)}>
          <Text style={styles.title}>{data.title}</Text>
        </Pressable>
        <Text style={styles.meta}>
          {repo}#{number} · {data.author} · {viewedCount}/{data.files.length} files viewed
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.toolbar}
          onPress={() => setHideViewed(!hideViewed)}
        >
          <Checkbox on={hideViewed} styles={styles} onToggle={() => setHideViewed(!hideViewed)} />
          <Text style={styles.meta}>Hide viewed files</Text>
        </Pressable>
        {FILE_GROUPS.map((group) => (
          <Group
            key={group}
            group={group}
            files={grouped.get(group) ?? []}
            hideViewed={hideViewed}
            selectedPath={selectedPath}
            styles={styles}
            onSelect={setSelectedPath}
            onSetViewed={onSetViewed}
          />
        ))}
      </ScrollView>
      {selected ? (
        <Diff
          repo={repo}
          number={number}
          data={data}
          file={selected}
          styles={styles}
          theme={props.theme}
          onSetViewed={onSetViewed}
          onNext={nextUnviewed}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.note}>Pick a file.</Text>
        </View>
      )}
    </View>
  );
}
