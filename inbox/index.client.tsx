import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";
import { InboxScreen, needsYouCount, useInbox } from "./client/inbox-screen";

const SCREEN_ID = "inbox";

function InboxSidebarRow(props: PluginSidebarItemProps) {
  const { data } = useInbox();
  const count = data ? needsYouCount(data) : 0;
  return (
    <SidebarRow
      icon="GitPullRequest"
      label="PR inbox"
      active={props.currentScreen?.screenId === SCREEN_ID}
      onPress={() => props.openScreen({ screenId: SCREEN_ID })}
      trailing={
        count ? (
          <Text style={{ fontSize: 12, color: props.theme.colors.statusWarning }}>{count}</Text>
        ) : undefined
      }
    />
  );
}

export default function contribute(client: PluginClientContext) {
  // The sidebar badge and the screen share one snapshot query.
  const queryClient = new QueryClient();
  const removers = [
    client.addScreen({
      id: SCREEN_ID,
      title: "PR inbox",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <InboxScreen {...props} />
        </QueryClientProvider>
      ),
    }),
    client.addSidebarHeaderItem({
      id: "inbox",
      title: "PR inbox",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <InboxSidebarRow {...props} />
        </QueryClientProvider>
      ),
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
    queryClient.clear();
  };
}
