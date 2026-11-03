import type { PluginAgentCommandContext, PluginClientContext } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AskScreen } from "./client/ask-screen";

const SCREEN_ID = "ask";

const openAsk = ({ agent, openScreen }: PluginAgentCommandContext, question = "") =>
  openScreen({ screenId: SCREEN_ID, params: { from: agent.id, fromTitle: agent.title ?? "this chat", q: question } });

export default function contribute(client: PluginClientContext) {
  const queryClient = new QueryClient();
  const removers = [
    client.addScreen({
      id: SCREEN_ID,
      title: "Ask another chat",
      Component: (props) => (
        <QueryClientProvider client={queryClient}>
          <AskScreen {...props} />
        </QueryClientProvider>
      ),
    }),
    client.addSlashCommand({
      name: "ask",
      description: "Ask another chat something; its answer comes back here",
      argumentHint: "<question>",
      context: "agent",
      onSubmit: (context) => openAsk(context, context.args.trim()),
    }),
    client.addCommandCenterItem({
      id: "ask-another-chat",
      title: "Ask another chat",
      icon: "MessagesSquare",
      keywords: ["ask", "other", "agent", "tab", "chat", "question"],
      context: "agent",
      onSelect: (context) => openAsk(context),
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
    queryClient.clear();
  };
}
