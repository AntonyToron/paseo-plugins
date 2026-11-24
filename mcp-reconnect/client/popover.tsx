import { openExternalUrl, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { ChatMcp } from "../shared/contracts";
import { ignoredServers, subscribe, view } from "./store";
import { ago, problems, RESULT_SHOWN_MS } from "./summary";

type Server = ChatMcp["servers"][number];

export interface PopoverActions {
  reconnect(agentId: string, workspaceId: string): void;
  check(agentId: string, workspaceId: string): void;
  ignore(name: string, ignored: boolean): void;
  signIn(agentId: string, server?: string): Promise<void>;
}

// Set by the plugin's contribute(); the popover is registered once and outlives any one poll.
export const actions: { current: PopoverActions | null } = { current: null };

const CONNECTOR_SETTINGS = "https://claude.ai/settings/connectors";
const isConnector = (name: string) => name.startsWith("claude.ai ");

export function McpPopover(props: PluginButtonContentProps) {
  const agentId = props.context === "agent" ? props.agentId : null;
  const { chat, activity } = useSyncExternalStore(subscribe, () => view(agentId ?? ""));
  const ignored = useSyncExternalStore(subscribe, ignoredServers);
  const [signInNote, setSignInNote] = useState<string | null>(null);
  const { colors } = props.theme;
  if (!agentId) return null;
  const workspaceId = props.workspaceId;
  const busy = activity?.kind === "reconnecting" || activity?.kind === "checking";
  const found = problems(chat, ignored);
  const connected = (chat?.servers ?? []).filter((server) => server.state === "connected");
  const pending = (chat?.servers ?? []).filter((server) => server.state === "pending");
  const codex = chat?.provider === "codex";
  const signIn = (server?: string) => {
    void actions.current
      ?.signIn(agentId, server)
      .then(() =>
        setSignInNote(
          server
            ? `Opened an "MCP sign-in" terminal tab running \`codex mcp login ${server}\`. Finish in the browser, then press Reconnect.`
            : 'Opened an "MCP sign-in" terminal tab running Claude. Type /mcp there, sign in, then press Reconnect.',
        ),
      )
      .catch((error: unknown) =>
        setSignInNote(
          `Couldn't open a terminal: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  const ignoredHere = (chat?.servers ?? []).filter(
    (server) => server.state !== "connected" && ignored.has(server.name),
  );

  const text = { fontSize: 13, color: colors.foreground } as const;
  const muted = { fontSize: 12, color: colors.foregroundMuted } as const;
  const heading = {
    fontSize: 11,
    fontWeight: "600" as const,
    color: colors.foregroundMuted,
    letterSpacing: 0.3,
  };
  const link = (label: string, onPress: () => void, tone: "accent" | "muted" = "accent") => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy}>
      <Text
        style={{ fontSize: 12, color: tone === "accent" ? colors.accent : colors.foregroundMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: primary ? colors.accent : colors.border,
        backgroundColor: primary ? colors.accent : "transparent",
        opacity: busy ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: primary ? colors.accentForeground : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const row = (server: Server, trailing: ReactNode) => (
    <View key={server.name} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={text}>{server.name}</Text>
        {server.detail ? (
          <Text style={muted} numberOfLines={2}>
            {server.detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );

  const status = (() => {
    if (activity?.kind === "reconnecting")
      return codex
        ? "Restarting this chat's Codex process…"
        : "Restarting this chat's Claude process, then checking every server. This takes about half a minute.";
    if (activity?.kind === "checking")
      return codex
        ? "Reading this chat's Codex log again, and which servers need a sign-in…"
        : "Checking every server, as a new Claude process here would see them…";
    if (activity?.kind === "error" && Date.now() - activity.at < RESULT_SHOWN_MS)
      return activity.message;
    if (activity?.kind === "done" && activity.reopened === false)
      return "The restart wasn't confirmed: Paseo didn't reopen the chat within 30 seconds. Try again.";
    if (!chat) return "No MCP state recorded for this chat yet.";
    const when = ago(chat.at);
    if (codex)
      return activity?.kind === "done" && activity.reopened
        ? "Restarted this chat's Codex process. Codex notes each server as it comes up, from your next message on, and never notes one dropping."
        : `From this chat's Codex log, last written ${when}. Codex never notes a server dropping, so one that went down mid-chat still shows as connected.`;
    if (chat.source === "check")
      return activity?.kind === "done" && activity.reopened
        ? `Restarted this chat's Claude process and checked every server ${when}.`
        : `Checked every server ${when}.`;
    return `As Claude recorded at this chat's last change, ${when}. Check again to see every server.`;
  })();

  return (
    <View style={{ padding: 14, gap: 12, minWidth: 340, maxWidth: 480 }}>
      {/* First, since a long list of servers pushes anything after it out of the popover. */}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {button("Reconnect", () => actions.current?.reconnect(agentId, workspaceId), true)}
        {button("Check again", () => actions.current?.check(agentId, workspaceId))}
        {!codex &&
        found.some((server) => server.state === "needs-auth" && !isConnector(server.name))
          ? button("Sign in…", () => signIn())
          : null}
      </View>
      {signInNote ? <Text style={muted}>{signInNote}</Text> : null}
      <Text style={muted}>{status}</Text>
      {found.filter((server) => server.state === "failed").length ? (
        <View style={{ gap: 8 }}>
          <Text style={heading}>FAILED</Text>
          {found
            .filter((server) => server.state === "failed")
            .map((server) =>
              row(
                server,
                link("Ignore", () => actions.current?.ignore(server.name, true), "muted"),
              ),
            )}
        </View>
      ) : null}
      {found.filter((server) => server.state === "needs-auth").length ? (
        <View style={{ gap: 8 }}>
          <Text style={heading}>NEEDS SIGN-IN</Text>
          <Text style={muted}>
            {codex
              ? "Restarting doesn't help these. Sign in to each, then reconnect."
              : "Restarting doesn't help these. Sign in with /mcp in a terminal Claude, or at claude.ai for claude.ai connectors, then reconnect."}
          </Text>
          {found
            .filter((server) => server.state === "needs-auth")
            .map((server) =>
              row(
                server,
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {codex ? link("Sign in", () => signIn(server.name)) : null}
                  {!codex && isConnector(server.name)
                    ? link("claude.ai", () => void openExternalUrl(CONNECTOR_SETTINGS))
                    : null}
                  {link("Ignore", () => actions.current?.ignore(server.name, true), "muted")}
                </View>,
              ),
            )}
        </View>
      ) : null}
      {pending.length ? (
        <Text style={muted}>
          {codex ? "Not connected yet" : "Still connecting"}:{" "}
          {pending.map((server) => server.name).join(", ")}
          {codex ? ". Codex notes a server once it's up, from the next message on." : ""}
        </Text>
      ) : null}
      {connected.length ? (
        <Text style={muted} numberOfLines={3}>
          Connected ({connected.length}): {connected.map((server) => server.name).join(", ")}
        </Text>
      ) : null}
      {chat?.apps.length ? (
        <Text style={muted} numberOfLines={3}>
          ChatGPT apps ({chat.apps.length}): {chat.apps.join(", ")}
        </Text>
      ) : null}
      {ignoredHere.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <Text style={muted}>Ignored:</Text>
          {ignoredHere.map((server) => (
            <Pressable
              key={server.name}
              accessibilityRole="button"
              accessibilityLabel={`Stop ignoring ${server.name}`}
              onPress={() => actions.current?.ignore(server.name, false)}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: colors.foregroundMuted,
                  textDecorationLine: "underline",
                }}
              >
                {server.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
