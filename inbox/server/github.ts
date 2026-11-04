import { execCommand } from "@getpaseo/plugin/server";
import type { MyPullRequest, ReviewRequest } from "../shared/model";

interface Login {
  login: string;
}
interface Actor extends Login {
  __typename: string;
}
interface SearchResult<Node> {
  data: { search: { nodes: Node[] } };
}

const REVIEW_REQUESTS = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url createdAt updatedAt headRefName body
        author { login }
        repository { nameWithOwner }
        labels(first: 20) { nodes { name } }
        latestOpinionatedReviews(first: 20) { nodes { author { login } state } }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) {
          nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } }
        }
      }
    }
  }
}`;

const MY_PULL_REQUESTS = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url isDraft reviewDecision updatedAt
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
        reviews(last: 50) { nodes { author { login __typename } submittedAt } }
        comments(last: 50) { nodes { author { login __typename } createdAt } }
      }
    }
  }
}`;

interface RequestNode {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  body: string;
  author: Login | null;
  repository: { nameWithOwner: string };
  labels: { nodes: { name: string }[] };
  latestOpinionatedReviews: { nodes: { author: Login | null; state: string }[] };
  timelineItems: { nodes: { createdAt?: string; requestedReviewer?: Partial<Login> | null }[] };
}

interface MineNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
  updatedAt: string;
  repository: { nameWithOwner: string };
  commits: {
    nodes: {
      commit: {
        committedDate: string;
        statusCheckRollup: { state: MyPullRequest["checks"] } | null;
      };
    }[];
  };
  reviews: { nodes: { author: Actor | null; submittedAt: string | null }[] };
  comments: { nodes: { author: Actor | null; createdAt: string }[] };
}

async function graphql<Node>(query: string, search: string): Promise<Node[]> {
  const { stdout } = await execCommand(
    "gh",
    ["api", "graphql", "-f", `query=${query}`, "-F", `q=${search}`],
    {
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  // Search returns an empty object for results that aren't pull requests.
  return (JSON.parse(stdout) as SearchResult<Node>).data.search.nodes.filter(
    (node) => Object.keys(node as object).length > 0,
  );
}

let myLogin: Promise<string> | null = null;
export function me(): Promise<string> {
  myLogin ??= execCommand("gh", ["api", "user", "--jq", ".login"], { timeout: 30_000 })
    .then(({ stdout }) => stdout.trim())
    .catch((error: unknown) => {
      myLogin = null;
      throw error;
    });
  return myLogin;
}

export async function reviewRequests(): Promise<ReviewRequest[]> {
  const login = await me();
  const nodes = await graphql<RequestNode>(
    REVIEW_REQUESTS,
    "is:pr is:open draft:false archived:false review-requested:@me",
  );
  return nodes.map((node) => {
    // Team requests carry no user login, so they fall back to the latest request of any kind.
    const requests = node.timelineItems.nodes.filter((event) => event.createdAt);
    const toMe = requests.filter((event) => event.requestedReviewer?.login === login);
    const requestedAt =
      (toMe.length ? toMe : requests)
        .map((event) => event.createdAt as string)
        .sort()
        .at(-1) ?? node.createdAt;
    const others = node.latestOpinionatedReviews.nodes.filter(
      (review) => review.author && review.author.login !== login,
    );
    const by = (state: string) =>
      others.filter((review) => review.state === state).map((review) => review.author?.login ?? "");
    return {
      approvedBy: by("APPROVED"),
      changesRequestedBy: by("CHANGES_REQUESTED"),
      repo: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      author: node.author?.login ?? "ghost",
      branch: node.headRefName,
      labels: node.labels.nodes.map((label) => label.name),
      requestedAt,
      updatedAt: node.updatedAt,
      body: node.body,
    };
  });
}

export async function myPullRequests(): Promise<MyPullRequest[]> {
  const nodes = await graphql<MineNode>(
    MY_PULL_REQUESTS,
    "is:pr is:open archived:false author:@me",
  );
  return nodes.map((node) => {
    const last = node.commits.nodes[0]?.commit;
    return {
      repo: node.repository.nameWithOwner,
      number: node.number,
      title: node.title,
      url: node.url,
      isDraft: node.isDraft,
      reviewDecision: node.reviewDecision,
      updatedAt: node.updatedAt,
      checks: last?.statusCheckRollup?.state ?? null,
      lastCommitAt: last?.committedDate ?? null,
      feedback: [
        ...node.reviews.nodes.flatMap((review) =>
          review.submittedAt
            ? [
                {
                  login: review.author?.login ?? "",
                  at: review.submittedAt,
                  isBot: review.author?.__typename === "Bot",
                },
              ]
            : [],
        ),
        ...node.comments.nodes.map((comment) => ({
          login: comment.author?.login ?? "",
          at: comment.createdAt,
          isBot: comment.author?.__typename === "Bot",
        })),
      ],
    };
  });
}
