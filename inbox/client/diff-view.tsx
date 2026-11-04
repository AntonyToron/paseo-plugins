import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { parseDiff, type DiffLine } from "../shared/review";

const MONO = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  lineHeight: 18,
};

function createStyles({ colors }: PluginTheme) {
  return {
    line: { flexDirection: "row" as const, minHeight: 18 },
    number: {
      ...MONO,
      width: 44,
      textAlign: "right" as const,
      paddingRight: 8,
      color: colors.foregroundMuted,
      opacity: 0.7,
    },
    code: { ...MONO, flex: 1, color: colors.foreground, paddingRight: 12 },
    sign: { ...MONO, width: 14, color: colors.foregroundMuted },
    hunk: {
      ...MONO,
      color: colors.foregroundMuted,
      backgroundColor: colors.surface2,
      paddingVertical: 2,
      paddingHorizontal: 10,
      marginVertical: 4,
    },
    meta: {
      ...MONO,
      color: colors.foregroundMuted,
      paddingHorizontal: 10,
      fontStyle: "italic" as const,
    },
  };
}

// Translucent, so the same tint reads on light and dark themes.
const ADD_BACKGROUND = "rgba(46, 160, 67, 0.16)";
const REMOVE_BACKGROUND = "rgba(248, 81, 73, 0.16)";

function Line({ line, styles }: { line: DiffLine; styles: ReturnType<typeof createStyles> }) {
  if (line.kind === "hunk")
    return (
      <Text style={styles.hunk} numberOfLines={1}>
        {line.text}
      </Text>
    );
  if (line.kind === "meta") return <Text style={styles.meta}>{line.text}</Text>;
  const background =
    line.kind === "add" ? ADD_BACKGROUND : line.kind === "remove" ? REMOVE_BACKGROUND : undefined;
  const sign = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " ";
  return (
    <View style={[styles.line, background ? { backgroundColor: background } : null]}>
      <Text style={styles.number}>{line.oldLine ?? ""}</Text>
      <Text style={styles.number}>{line.newLine ?? ""}</Text>
      <Text style={styles.sign}>{sign}</Text>
      <Text style={styles.code} selectable>
        {line.text || " "}
      </Text>
    </View>
  );
}

/** A unified diff, virtualized so a thousand-line file scrolls as fast as a short one. */
export function DiffView({ diff, theme }: { diff: string; theme: PluginTheme }) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const lines = useMemo(() => parseDiff(diff), [diff]);
  return (
    <FlatList
      data={lines}
      keyExtractor={(_line, index) => String(index)}
      renderItem={({ item }) => <Line line={item} styles={styles} />}
      initialNumToRender={80}
      windowSize={15}
    />
  );
}
