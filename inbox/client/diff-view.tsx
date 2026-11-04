import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { HoverPressable } from "./hover";
import type { DiffLine } from "../shared/review";
import type { Segment } from "./decorate";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// GitHub's diff palette, translucent so it sits on light and dark themes alike: a pale line tint
// with a stronger tint behind the line numbers.
const TINTS = {
  add: { line: "rgba(46, 160, 67, 0.15)", gutter: "rgba(63, 185, 80, 0.3)", sign: "#3fb950" },
  remove: { line: "rgba(248, 81, 73, 0.15)", gutter: "rgba(248, 81, 73, 0.3)", sign: "#f85149" },
  hunk: { line: "rgba(56, 139, 253, 0.12)", gutter: "rgba(56, 139, 253, 0.2)" },
};

// GitHub's syntax colours, keyed by Prism token type.
const SYNTAX = {
  dark: {
    comment: "#8b949e",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    constant: "#79c0ff",
    function: "#d2a8ff",
    type: "#ffa657",
    tag: "#7ee787",
  },
  light: {
    comment: "#6e7781",
    keyword: "#cf222e",
    string: "#0a3069",
    constant: "#0550ae",
    function: "#8250df",
    type: "#953800",
    tag: "#116329",
  },
};
type SyntaxRole = keyof (typeof SYNTAX)["dark"];

const ROLES: Record<string, SyntaxRole> = {
  comment: "comment",
  prolog: "comment",
  doctype: "comment",
  cdata: "comment",
  keyword: "keyword",
  important: "keyword",
  atrule: "keyword",
  rule: "keyword",
  string: "string",
  char: "string",
  "template-string": "string",
  "template-punctuation": "string",
  "attr-value": "string",
  regex: "string",
  url: "string",
  number: "constant",
  boolean: "constant",
  constant: "constant",
  property: "constant",
  "attr-name": "constant",
  symbol: "constant",
  builtin: "constant",
  entity: "constant",
  function: "function",
  "function-variable": "function",
  "class-name": "type",
  "maybe-class-name": "type",
  tag: "tag",
  selector: "tag",
};

// Pieces of a line edited in place, over the line's own tint.
const CHANGED = { add: "rgba(46, 160, 67, 0.4)", remove: "rgba(248, 81, 73, 0.4)" };

const isDark = (hex: string) => {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!match) return true;
  const [red, green, blue] = match.slice(1).map((part) => parseInt(part, 16));
  return 0.299 * red! + 0.587 * green! + 0.114 * blue! < 128;
};

export function createDiffStyles({ colors }: PluginTheme) {
  const palette = SYNTAX[isDark(colors.surface0) ? "dark" : "light"];
  return {
    tokenColor: (type: string | null) => {
      const role = type ? ROLES[type] : undefined;
      return role ? palette[role] : undefined;
    },
    line: { flexDirection: "row" as const },
    gutter: { flexDirection: "row" as const, flexShrink: 0, cursor: "pointer" as const },
    lineHovered: { backgroundColor: "rgba(56, 139, 253, 0.08)" },
    signColumn: { width: 18 },
    // GitHub's blue "+" that appears on the line you point at.
    addComment: {
      position: "absolute" as const,
      top: 1,
      left: 0,
      width: 18,
      height: 18,
      borderRadius: 4,
      backgroundColor: "#1f6feb",
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    addCommentLabel: { color: "#ffffff", fontSize: 14, lineHeight: 16, fontWeight: "700" as const },
    number: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 20,
      width: 48,
      textAlign: "right" as const,
      paddingRight: 10,
      color: colors.foregroundMuted,
    },
    sign: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 20,
      width: 18,
      textAlign: "center" as const,
    },
    // Pieces of a line don't inherit the line's font on the web, so they carry it themselves.
    segment: { fontFamily: MONO, fontSize: 12, lineHeight: 20 },
    code: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 20,
      flex: 1,
      color: colors.foreground,
      paddingRight: 16,
    },
    hunkText: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 20,
      flex: 1,
      color: colors.foregroundMuted,
      paddingHorizontal: 10,
    },
    meta: {
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: 24,
      color: colors.foregroundMuted,
      paddingHorizontal: 16,
      fontStyle: "italic" as const,
    },
  };
}

export type DiffStyles = ReturnType<typeof createDiffStyles>;

/** One line of a unified diff, in GitHub's colours. */
export function DiffLineRow({
  line,
  segments,
  styles,
  onComment,
}: {
  line: DiffLine;
  segments: readonly Segment[] | null;
  styles: DiffStyles;
  /** Starts a comment on this line; absent for lines that can't take one. */
  onComment?: () => void;
}) {
  if (line.kind === "hunk") {
    return (
      <View style={[styles.line, { backgroundColor: TINTS.hunk.line }]}>
        <View style={[styles.gutter, { backgroundColor: TINTS.hunk.gutter, width: 114 }]} />
        <Text style={styles.hunkText} numberOfLines={1}>
          {line.text}
        </Text>
      </View>
    );
  }
  if (line.kind === "meta") return <Text style={styles.meta}>{line.text}</Text>;
  const tint = line.kind === "add" ? TINTS.add : line.kind === "remove" ? TINTS.remove : null;
  const changedTint = line.kind === "context" ? undefined : CHANGED[line.kind];
  return (
    // No onPress: the line only tracks the pointer, so its code stays selectable.
    <HoverPressable
      focusable={false}
      style={({ hovered }) => [
        styles.line,
        tint ? { backgroundColor: tint.line } : null,
        hovered && onComment ? styles.lineHovered : null,
      ]}
    >
      {({ hovered }) => (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Comment on this line"
            disabled={!onComment}
            onPress={onComment}
            style={[styles.gutter, tint ? { backgroundColor: tint.gutter } : null]}
          >
            <Text style={styles.number}>{line.oldLine ?? ""}</Text>
            <Text style={styles.number}>{line.newLine ?? ""}</Text>
          </Pressable>
          <View style={styles.signColumn}>
            <Text style={[styles.sign, tint ? { color: tint.sign } : null]}>
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
            </Text>
            {/* Always mounted and only faded in: hover can end as a press starts, and a button
                that unmounts then never sees the click. */}
            {onComment ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Comment on this line"
                onPress={onComment}
                style={[styles.addComment, { opacity: hovered ? 1 : 0 }]}
              >
                <Text style={styles.addCommentLabel}>+</Text>
              </Pressable>
            ) : null}
          </View>
          {renderCode()}
        </>
      )}
    </HoverPressable>
  );

  function renderCode() {
    return (
      <Text style={styles.code} selectable>
        {segments?.length
          ? segments.map((segment, index) => (
              <Text
                key={index}
                style={[
                  styles.segment,
                  {
                    color: styles.tokenColor(segment.type) ?? styles.code.color,
                    backgroundColor: segment.changed ? changedTint : undefined,
                  },
                ]}
              >
                {segment.text}
              </Text>
            ))
          : line.text || " "}
      </Text>
    );
  }
}
