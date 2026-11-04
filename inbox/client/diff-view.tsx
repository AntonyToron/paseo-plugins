import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { DiffLine } from "../shared/review";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// GitHub's diff palette, translucent so it sits on light and dark themes alike: a pale line tint
// with a stronger tint behind the line numbers.
const TINTS = {
  add: { line: "rgba(46, 160, 67, 0.15)", gutter: "rgba(63, 185, 80, 0.3)", sign: "#3fb950" },
  remove: { line: "rgba(248, 81, 73, 0.15)", gutter: "rgba(248, 81, 73, 0.3)", sign: "#f85149" },
  hunk: { line: "rgba(56, 139, 253, 0.12)", gutter: "rgba(56, 139, 253, 0.2)" },
};

export function createDiffStyles({ colors }: PluginTheme) {
  return {
    line: { flexDirection: "row" as const },
    gutter: { flexDirection: "row" as const, flexShrink: 0 },
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
export function DiffLineRow({ line, styles }: { line: DiffLine; styles: DiffStyles }) {
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
  return (
    <View style={[styles.line, tint ? { backgroundColor: tint.line } : null]}>
      <View style={[styles.gutter, tint ? { backgroundColor: tint.gutter } : null]}>
        <Text style={styles.number}>{line.oldLine ?? ""}</Text>
        <Text style={styles.number}>{line.newLine ?? ""}</Text>
      </View>
      <Text style={[styles.sign, tint ? { color: tint.sign } : null]}>
        {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
      </Text>
      <Text style={styles.code} selectable>
        {line.text || " "}
      </Text>
    </View>
  );
}
