import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";
import { DashScreen } from "./client/dash-screen";
import { NeedsMeView } from "./client/needs-me-view";
import { attentionCount, useDashSnapshot } from "./client/use-dash";

const SCREEN_ID = "dash";

function DashSidebarRow(props: PluginSidebarItemProps) {
  const { data: groups } = useDashSnapshot();
  const count = groups ? attentionCount(groups) : 0;
  return (
    <SidebarRow
      icon="LayoutList"
      label="Dash"
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
      title: "Dash",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <DashScreen {...props} />
        </QueryClientProvider>
      ),
    }),
    client.addSidebarHeaderItem({
      id: "dash",
      title: "Dash",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <DashSidebarRow {...props} />
        </QueryClientProvider>
      ),
    }),
    // Chosen per device in Settings → Sidebar.
    client.addSidebarView({
      id: "needs-me",
      title: "Needs me",
      description: "Workspaces grouped by what they need from you, with each one's PR state",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <NeedsMeView {...props} />
        </QueryClientProvider>
      ),
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
    queryClient.clear();
  };
}
