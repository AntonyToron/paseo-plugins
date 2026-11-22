import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { startReview } from "../shared/contracts";

type Paseo = PluginHandlerContext["paseo"];
type Agent = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number]["agent"];

const PAGE_LIMIT = 200;
const REVIEW_TITLE = /\breview\b/i;
const MAX_TITLE_CHARS = 200;

async function recentAgents(paseo: Paseo): Promise<Agent[]> {
  const page = await paseo.agents.list({
    filter: { includeArchived: true },
    page: { limit: PAGE_LIMIT },
  });
  return page.entries
    .map((entry) => entry.agent)
    .filter((agent) => agent.provider === "claude")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Starts a review the way you start them by hand: a worktree workspace with the PR checked out,
 * whose first message is `/pr-review <url>`.
 */
export async function startReviewChat(
  { repo, number, title, url }: RpcInput<typeof startReview>,
  { paseo }: PluginHandlerContext,
) {
  return startChatInRepo(paseo, {
    repo,
    title: `Review PR #${number} ${title}`,
    prompt: `/pr-review ${url}`,
    pullRequest: number,
  });
}

const PR_URL = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

/**
 * An active worktree workspace that already has this PR checked out. Git keeps a branch in one
 * worktree at a time, so a second checkout of the same PR can't be made; the chat goes here.
 */
async function prWorkspace(paseo: Paseo, repo: string, number: number) {
  const { entries } = await paseo.workspaces.list({ page: { limit: PAGE_LIMIT } });
  return entries.find((workspace) => {
    const url = PR_URL.exec(workspace.githubRuntime?.pullRequest?.url ?? "");
    return (
      !workspace.archivingAt &&
      workspace.workspaceKind === "worktree" &&
      url?.[1]?.toLowerCase() === repo.toLowerCase() &&
      Number(url[2]) === number
    );
  });
}

/**
 * A new chat on the repo's Paseo project, in a new workspace. With a PR, the workspace is a
 * worktree with the PR checked out, so its branch, diff, PR panel and scripts are the PR's, and
 * archiving it removes the worktree. It copies the model, mode and thinking setting of your most
 * recent review chat.
 */
export async function startChatInRepo(
  paseo: Paseo,
  {
    repo,
    title,
    prompt,
    pullRequest,
  }: { repo: string; title: string; prompt: string; pullRequest?: number },
) {
  const key = `remote:github.com/${repo}`.toLowerCase();
  const { projects } = await paseo.projects.list();
  const matching = projects.filter((project) => (project.projectKey ?? "").toLowerCase() === key);
  if (!matching.length) {
    throw new Error(
      `No Paseo project points at ${repo}. Add its checkout as a project in Paseo, then try again.`,
    );
  }
  const agents = await recentAgents(paseo);
  const inProject = (agent: Agent) =>
    matching.find(
      (project) =>
        agent.cwd === project.projectRootPath ||
        agent.cwd.startsWith(`${project.projectRootPath}/`),
    );
  const template =
    agents.find((agent) => inProject(agent) && REVIEW_TITLE.test(agent.title ?? "")) ??
    agents.find(inProject) ??
    agents[0];
  if (!template?.model)
    throw new Error(
      "No earlier Claude chat to copy the model and settings from. Start one review by hand first.",
    );
  const project = (template && inProject(template)) ?? matching[0];
  if (!project) throw new Error(`No Paseo project points at ${repo}.`);

  const existing = pullRequest ? await prWorkspace(paseo, repo, pullRequest) : undefined;
  const workspace = existing
    ? paseo.workspaces.ref(existing.id)
    : await paseo.workspaces.create({
        title: title.slice(0, MAX_TITLE_CHARS),
        // Tells the daemon an agent follows, so the workspace doesn't sit there looking idle.
        firstAgentContext: { prompt, attachments: [] },
        source: pullRequest
          ? {
              kind: "worktree",
              cwd: project.projectRootPath,
              projectId: project.projectId,
              action: "checkout",
              checkoutSource: { kind: "change_request", number: pullRequest },
            }
          : { kind: "directory", path: project.projectRootPath, projectId: project.projectId },
      });
  const agent = await workspace.agents.create({
    config: {
      provider: `claude/${template.model}`,
      ...(template.currentModeId ? { modeId: template.currentModeId } : {}),
      ...(template.thinkingOptionId ? { thinkingOptionId: template.thinkingOptionId } : {}),
    },
    prompt,
  });
  return { agentId: agent.id };
}
