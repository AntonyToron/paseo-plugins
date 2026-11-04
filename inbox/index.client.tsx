import type {
  PluginAgentCommandContext,
  PluginClientContext,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";
import { InboxScreen, needsYouCount, useInbox } from "./client/inbox-screen";
import { ReviewScreen } from "./client/review-screen";
import { resolvePullRequest } from "./shared/review";

const SCREEN_ID = "inbox";
const REVIEW_SCREEN_ID = "review";

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
  // The sidebar badge and the screens share one query cache.
  const queryClient = new QueryClient();
  const openReview = (repo: string, number: number) =>
    client.openScreen({ screenId: REVIEW_SCREEN_ID, params: { repo, number: String(number) } });
  const reviewFromSlash = async (context: PluginAgentCommandContext & { args: string }) => {
    const { repo, number } = await context.rpc(resolvePullRequest, {
      reference: context.args.trim(),
      cwd: context.workspace.directory,
    });
    openReview(repo, number);
  };
  const removers = [
    client.addScreen({
      id: SCREEN_ID,
      title: "PR inbox",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <InboxScreen {...props} openReview={openReview} />
        </QueryClientProvider>
      ),
    }),
    client.addScreen({
      id: REVIEW_SCREEN_ID,
      title: (params) =>
        params.repo ? `${params.repo.split("/").at(-1)}#${params.number} files` : "Review files",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <ReviewScreen {...props} />
        </QueryClientProvider>
      ),
    }),
    // One registration per name: Paseo rejects a second context for the same command, and
    // that rejection takes the whole plugin down with it.
    client.addSlashCommand({
      name: "review-files",
      description: "Review a PR's files: grouped, with GitHub's Viewed marks and fast diffs",
      argumentHint: "<PR URL or number>",
      context: "agent",
      onSubmit: reviewFromSlash,
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
