import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Text, View, type NativeSyntheticEvent } from "react-native";
import {
  deleteComment,
  getComments,
  getSendTargets,
  saveComment,
  sendComments,
  type CommentAnchor,
  type PendingComment,
  type SendTarget,
} from "../shared/comments";
import { HoverPressable } from "./hover";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const commentKeys = {
  list: (repo: string, number: number) => ["paseo-review", repo, number, "comments"] as const,
  targets: (repo: string, number: number) =>
    ["paseo-review", repo, number, "send-targets"] as const,
};

export function useComments(repo: string, number: number) {
  const load = useRpc(getComments);
  return useQuery({
    queryKey: commentKeys.list(repo, number),
    queryFn: () => load({ repo, number }),
  });
}

export function useSaveComment(repo: string, number: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const save = useRpc(saveComment);
  return useMutation({
    mutationFn: (input: { id: string | null; anchor: CommentAnchor; body: string }) =>
      save({ repo, number, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentKeys.list(repo, number) }),
    onError: (error) => toast.error(`Couldn't save the comment: ${error.message}`),
  });
}

export function useDeleteComment(repo: string, number: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useRpc(deleteComment);
  return useMutation({
    mutationFn: (id: string) => remove({ repo, number, id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentKeys.list(repo, number) }),
    onError: (error) => toast.error(`Couldn't delete the comment: ${error.message}`),
  });
}

export function createCommentStyles({ colors }: PluginTheme) {
  return {
    box: {
      marginVertical: 6,
      marginLeft: 114,
      marginRight: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      overflow: "hidden" as const,
    },
    boxHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    pendingBadge: {
      fontSize: 10,
      fontWeight: "600" as const,
      color: colors.statusWarning,
      borderWidth: 1,
      borderColor: colors.statusWarning,
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    who: { flex: 1, fontSize: 12, color: colors.foregroundMuted },
    body: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.foreground,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 10,
    },
    input: {
      minHeight: 72,
      margin: 10,
      marginBottom: 0,
      padding: 10,
      fontSize: 13,
      lineHeight: 19,
      color: colors.foreground,
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
    },
    actions: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "flex-end" as const,
      gap: 8,
      padding: 10,
    },
    hint: { flex: 1, fontSize: 11, color: colors.foregroundMuted },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    buttonHovered: { backgroundColor: colors.surface2 },
    buttonLabel: { fontSize: 12, fontWeight: "500" as const, color: colors.foreground },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryHovered: { opacity: 0.88 },
    primaryLabel: { fontSize: 12, fontWeight: "600" as const, color: colors.accentForeground },
    disabled: { opacity: 0.5 },
    link: { fontSize: 12, color: colors.foregroundMuted },
    linkHovered: { color: colors.foreground, textDecorationLine: "underline" as const },
    danger: { color: colors.statusDanger },
    // The send dialog.
    section: {
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.3,
      color: colors.foregroundMuted,
    },
    summary: { gap: 6 },
    summaryRow: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
    summaryWhere: { fontSize: 12, color: colors.foregroundMuted, fontFamily: MONO },
    summaryBody: { flex: 1, fontSize: 13, color: colors.foreground },
    targets: { gap: 4 },
    target: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "transparent",
    },
    targetHovered: { backgroundColor: colors.surface1 },
    targetSelected: { borderColor: colors.accent, backgroundColor: colors.surface1 },
    radio: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: colors.foregroundMuted,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    radioOn: { borderColor: colors.accent },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    targetText: { flex: 1, gap: 2 },
    targetTitle: { fontSize: 13, color: colors.foreground },
    targetMeta: { fontSize: 11, color: colors.foregroundMuted },
    onPr: { fontSize: 10, fontWeight: "600" as const, color: colors.statusSuccess },
    footer: {
      flexDirection: "row" as const,
      justifyContent: "flex-end" as const,
      gap: 8,
    },
    error: { fontSize: 12, color: colors.statusDanger },
  };
}
export type CommentStyles = ReturnType<typeof createCommentStyles>;

function Button({
  label,
  primary,
  disabled,
  styles,
  onPress,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  styles: CommentStyles;
  onPress(): void;
}) {
  return (
    <HoverPressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }) => [
        styles.button,
        primary && styles.primary,
        hovered && !disabled && (primary ? styles.primaryHovered : styles.buttonHovered),
        disabled && styles.disabled,
      ]}
    >
      <Text style={primary ? styles.primaryLabel : styles.buttonLabel}>{label}</Text>
    </HoverPressable>
  );
}

export function TextLink({
  label,
  danger,
  styles,
  onPress,
}: {
  label: string;
  danger?: boolean;
  styles: CommentStyles;
  onPress(): void;
}) {
  return (
    <HoverPressable accessibilityRole="button" onPress={onPress}>
      {({ hovered }) => (
        <Text style={[styles.link, danger && styles.danger, hovered && styles.linkHovered]}>
          {label}
        </Text>
      )}
    </HoverPressable>
  );
}

type KeyEvent = NativeSyntheticEvent<{ key: string; metaKey?: boolean; ctrlKey?: boolean }>;

/**
 * Writing or editing a comment under a line. ⌘↵ saves, Esc cancels. The text is this box's own
 * state, so a keystroke redraws only the box, not the review screen's hundreds of rows. The
 * screen keeps a copy through `onChangeBody` (a ref, not state) because the list unmounts rows
 * scrolled far away, and the box starts again from `initialBody` when it comes back.
 */
export function CommentComposer({
  initialBody,
  editing,
  saving,
  styles,
  onChangeBody,
  onSave,
  onCancel,
}: {
  initialBody: string;
  editing: boolean;
  saving: boolean;
  styles: CommentStyles;
  onChangeBody(body: string): void;
  onSave(body: string): void;
  onCancel(): void;
}) {
  const [body, setBody] = useState(initialBody);
  const save = () => {
    if (body.trim()) onSave(body.trim());
  };
  return (
    <View style={styles.box}>
      <TextInput
        autoFocus
        multiline
        value={body}
        onChangeText={(text) => {
          setBody(text);
          onChangeBody(text);
        }}
        placeholder="Leave a comment for the chat. It stays here until you send it."
        style={styles.input}
        onKeyPress={(event: KeyEvent) => {
          const { key, metaKey, ctrlKey } = event.nativeEvent;
          if (key === "Escape") onCancel();
          if (key === "Enter" && (metaKey || ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <View style={styles.actions}>
        <Text style={styles.hint}>⌘↵ to save · Esc to cancel</Text>
        <Button label="Cancel" styles={styles} onPress={onCancel} />
        <Button
          label={editing ? "Save" : "Add comment"}
          primary
          disabled={!body.trim() || saving}
          styles={styles}
          onPress={save}
        />
      </View>
    </View>
  );
}

export function CommentCard({
  comment,
  styles,
  onEdit,
  onDelete,
}: {
  comment: PendingComment;
  styles: CommentStyles;
  onEdit(): void;
  onDelete(): void;
}) {
  return (
    <View style={styles.box}>
      <View style={styles.boxHeader}>
        <Text style={styles.pendingBadge}>PENDING</Text>
        <Text style={styles.who}>Not sent yet</Text>
        <TextLink label="Edit" styles={styles} onPress={onEdit} />
        <TextLink label="Delete" danger styles={styles} onPress={onDelete} />
      </View>
      <Text style={styles.body} selectable>
        {comment.body}
      </Text>
    </View>
  );
}

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

function TargetRow({
  label,
  meta,
  onPr,
  selected,
  styles,
  onPress,
}: {
  label: string;
  meta: string;
  onPr?: boolean;
  selected: boolean;
  styles: CommentStyles;
  onPress(): void;
}) {
  return (
    <HoverPressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ hovered }) => [
        styles.target,
        hovered && styles.targetHovered,
        selected && styles.targetSelected,
      ]}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.targetText}>
        <Text style={styles.targetTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.targetMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {onPr ? <Text style={styles.onPr}>ON THIS PR</Text> : null}
    </HoverPressable>
  );
}

/** Reviews the pending comments and sends them, with an optional note, to a chat. */
export function SendDialog({
  repo,
  number,
  url,
  title,
  comments,
  open,
  styles,
  onClose,
  onSent,
}: {
  repo: string;
  number: number;
  url: string;
  title: string;
  comments: readonly PendingComment[];
  open: boolean;
  styles: CommentStyles;
  onClose(): void;
  onSent(agentId: string, sent: number): void;
}) {
  const queryClient = useQueryClient();
  const loadTargets = useRpc(getSendTargets);
  const send = useRpc(sendComments);
  const targets = useQuery({
    queryKey: commentKeys.targets(repo, number),
    queryFn: () => loadTargets({ repo, number }),
    enabled: open,
  });
  const [note, setNote] = useState("");
  // undefined: not picked yet, so the first chat on this PR is preselected; null: a new chat.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const list: readonly SendTarget[] = targets.data?.targets ?? [];
  const selected =
    picked !== undefined
      ? picked
      : (list.find((target) => target.onThisPullRequest)?.agentId ?? null);
  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    [comments],
  );
  const sending = useMutation({
    mutationFn: () => send({ repo, number, agentId: selected, note, url, title }),
    onSuccess: async ({ agentId, sent }) => {
      await queryClient.invalidateQueries({ queryKey: commentKeys.list(repo, number) });
      setNote("");
      setPicked(undefined);
      onSent(agentId, sent);
    },
  });

  return (
    <Modal
      title={`Send ${comments.length} ${comments.length === 1 ? "comment" : "comments"} to a chat`}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Content>
        <Text style={styles.section}>COMMENTS</Text>
        <View style={styles.summary}>
          {sorted.map((comment) => (
            <View key={comment.id} style={styles.summaryRow}>
              <Text style={styles.summaryWhere}>
                {comment.path.split("/").at(-1)}:{comment.line}
              </Text>
              <Text style={styles.summaryBody} numberOfLines={2}>
                {comment.body}
              </Text>
            </View>
          ))}
        </View>
        <TextInput
          multiline
          value={note}
          onChangeText={setNote}
          placeholder="Add a note above them, e.g. what you'd like the chat to do (optional)"
          style={styles.input}
        />
        <Text style={styles.section}>SEND TO</Text>
        <View style={styles.targets}>
          <TargetRow
            label="A new chat"
            meta={`In ${repo}'s Paseo project, set up like your last review chat`}
            selected={selected === null}
            styles={styles}
            onPress={() => setPicked(null)}
          />
          {targets.isPending ? <ActivityIndicator /> : null}
          {targets.error ? <Text style={styles.error}>{targets.error.message}</Text> : null}
          {list.map((target) => (
            <TargetRow
              key={target.agentId}
              // A chat's own title is its first message; its workspace's title reads better.
              label={target.workspaceTitle ?? target.title}
              meta={[ago(target.lastActivityAt), target.workspaceTitle ? target.title : null]
                .filter(Boolean)
                .join(" · ")}
              onPr={target.onThisPullRequest}
              selected={selected === target.agentId}
              styles={styles}
              onPress={() => setPicked(target.agentId)}
            />
          ))}
        </View>
        {sending.error ? <Text style={styles.error}>{sending.error.message}</Text> : null}
        <View style={styles.footer}>
          <Button label="Cancel" styles={styles} onPress={onClose} />
          <Button
            label={sending.isPending ? "Sending…" : "Send"}
            primary
            disabled={sending.isPending || !comments.length}
            styles={styles}
            onPress={() => sending.mutate()}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}
