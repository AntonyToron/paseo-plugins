import type { PluginClientContext, PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResumePopover, ResumeSidebarRow } from "./client/resume-ui";

export default function contribute(client: PluginClientContext) {
  // The sidebar row and its popover render in separate trees but share one cache.
  const queryClient = new QueryClient();
  const remove = client.addSidebarHeaderItem({
    id: "resume",
    title: "Resume interrupted chats",
    Component: (props: PluginSidebarItemProps) => (
      <QueryClientProvider client={queryClient}>
        <ResumeSidebarRow
          {...props}
          openPopover={(Content) =>
            props.openPopover((popoverProps: PluginPopoverProps) => (
              <QueryClientProvider client={queryClient}>
                <Content {...popoverProps} />
              </QueryClientProvider>
            ))
          }
        />
      </QueryClientProvider>
    ),
  });
  return () => {
    void remove();
    queryClient.clear();
  };
}
