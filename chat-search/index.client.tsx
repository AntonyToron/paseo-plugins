import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SearchScreen } from "./client/search-screen";

const SCREEN_ID = "search";

export default function contribute(client: PluginClientContext) {
  const queryClient = new QueryClient();
  const removers = [
    client.addScreen({
      id: SCREEN_ID,
      title: "Search chats",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <SearchScreen {...props} />
        </QueryClientProvider>
      ),
    }),
    client.addSidebarHeaderItem({
      id: "search-chats",
      title: "Search chats",
      Component: (props) => (
        <SidebarRow
          icon="MessageSquareText"
          label="Search chats"
          active={props.currentScreen?.screenId === SCREEN_ID}
          onPress={() => props.openScreen({ screenId: SCREEN_ID })}
        />
      ),
    }),
    client.addCommandCenterItem({
      id: "search-chats",
      title: "Search chats",
      icon: "MessageSquareText",
      keywords: ["find", "chat", "conversation", "history", "transcript", "where did we"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: SCREEN_ID }),
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
    queryClient.clear();
  };
}
