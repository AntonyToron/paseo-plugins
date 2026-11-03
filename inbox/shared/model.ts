import { z } from "zod";

export const inboxItem = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  /** Why the item is in its section, in a few words. */
  reason: z.string(),
  /** When it started waiting on you: the review request, or the feedback you haven't answered. */
  since: z.string(),
  kind: z.enum(["review", "mine"]),
});
export type InboxItem = z.infer<typeof inboxItem>;

export const inboxSnapshot = z.object({
  priority: z.array(inboxItem),
  reviews: z.array(inboxItem),
  mine: z.array(inboxItem),
  stale: z.array(inboxItem),
  /** Your open PRs with nothing for you to do right now. */
  quietMine: z.number(),
});
export type InboxSnapshot = z.infer<typeof inboxSnapshot>;

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 30;
const MEDIUM_WAIT_DAYS = 5;

// Titles and branches that touch who can do what. Broad on purpose: the list it feeds is short.
const SECURITY = new RegExp(
  [
    "security",
    "vulnerab",
    "exploit",
    "\\bcve\\b",
    "ghsa",
    "\\bxss\\b",
    "csrf",
    "ssrf",
    "injection",
    "\\bauth(n|z|enticat\\w*|ori[sz]\\w*)?\\b",
    "oauth",
    "\\bsso\\b",
    "saml",
    "\\b2fa\\b",
    "\\bmfa\\b",
    "totp",
    "password",
    "credential",
    "secret",
    "token",
    "permission",
    "privilege",
    "access (check|control)",
    "cloudflare access",
    "rate[- ]limit",
    "\\bleak",
    "pkce",
    "superuser",
    "super-admin",
    "admin panel",
    "\\bgate[sd]?\\b",
  ].join("|"),
  "i",
);

export type Priority = "High Priority" | "Medium Priority" | "Low Priority" | null;

export const priorityLabel = (labels: readonly string[]): Priority =>
  (["High Priority", "Medium Priority", "Low Priority"] as const).find((label) =>
    labels.includes(label),
  ) ?? null;

export const looksSecurityRelated = (title: string, branch: string) =>
  SECURITY.test(title) || SECURITY.test(branch);

export interface ReviewRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  branch: string;
  labels: string[];
  requestedAt: string;
  /** Other reviewers' current verdicts. */
  approvedBy: string[];
  changesRequestedBy: string[];
}

const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / DAY_MS);

const names = (logins: readonly string[]) =>
  logins.length > 2 ? `${logins.slice(0, 2).join(", ")} and others` : logins.join(" and ");

/** What other reviewers have said, so you know whether you're the first look or a second opinion. */
export function verdicts(request: ReviewRequest): string | null {
  if (request.changesRequestedBy.length)
    return `changes requested by ${names(request.changesRequestedBy)}`;
  if (request.approvedBy.length) return `approved by ${names(request.approvedBy)}`;
  return null;
}

/**
 * Why a review request belongs at the top, if it does, with a rank to order the top by.
 * High Priority first, then security-looking PRs that aren't marked Low, then Medium Priority
 * ones that have waited on you for days with nobody else having approved them. Anything older
 * than the stale cutoff only rises for the first two reasons.
 */
export function urgency(
  request: ReviewRequest,
  now: number,
): { reason: string; rank: number } | null {
  const priority = priorityLabel(request.labels);
  const waited = daysSince(request.requestedAt, now);
  if (priority === "High Priority") return { reason: "High priority", rank: 3 };
  if (priority !== "Low Priority" && looksSecurityRelated(request.title, request.branch)) {
    return { reason: priority ? `Security · ${priority.toLowerCase()}` : "Security", rank: 2 };
  }
  const covered = request.approvedBy.length > 0;
  if (
    priority === "Medium Priority" &&
    !covered &&
    waited > MEDIUM_WAIT_DAYS &&
    waited <= STALE_AFTER_DAYS
  ) {
    return { reason: `Medium priority · waiting ${waited} days`, rank: 1 };
  }
  return null;
}

export function sortReviewRequests(requests: readonly ReviewRequest[], now: number) {
  const priority: (InboxItem & { rank: number })[] = [];
  const reviews: InboxItem[] = [];
  const stale: InboxItem[] = [];
  for (const request of requests) {
    const item = {
      repo: request.repo,
      number: request.number,
      title: request.title,
      url: request.url,
      author: request.author,
      since: request.requestedAt,
      kind: "review" as const,
    };
    const urgent = urgency(request, now);
    const waited = daysSince(request.requestedAt, now);
    const withVerdicts = (reason: string) =>
      [reason, verdicts(request)].filter(Boolean).join(" · ");
    if (urgent) priority.push({ ...item, reason: withVerdicts(urgent.reason), rank: urgent.rank });
    else if (waited > STALE_AFTER_DAYS)
      stale.push({ ...item, reason: withVerdicts(`requested ${waited} days ago`) });
    else
      reviews.push({
        ...item,
        reason: withVerdicts(priorityLabel(request.labels)?.toLowerCase() ?? "review requested"),
      });
  }
  const oldestFirst = (a: InboxItem, b: InboxItem) => a.since.localeCompare(b.since);
  return {
    priority: priority
      .sort((a, b) => b.rank - a.rank || oldestFirst(a, b))
      .map(({ rank: _rank, ...item }) => item),
    reviews: reviews.sort(oldestFirst),
    stale: stale.sort(oldestFirst),
  };
}

export interface Activity {
  login: string;
  at: string;
  isBot: boolean;
}

export interface MyPullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  reviewDecision: string | null;
  checks: "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED" | null;
  lastCommitAt: string | null;
  /** Reviews and conversation comments, from everyone. */
  feedback: Activity[];
}

// Bot posts aren't feedback you owe an answer to. GitHub marks app accounts as bots; the
// names cover the ones that post through a regular account.
const BOT_NAMES = new Set([
  "github-actions",
  "coderabbitai",
  "vercel",
  "codecov",
  "sentry-io",
  "linear-code",
]);
export const isPerson = (entry: Activity) =>
  Boolean(entry.login) &&
  !entry.isBot &&
  !BOT_NAMES.has(entry.login) &&
  !entry.login.endsWith("[bot]");

/**
 * What, if anything, you need to do on your own PR. Feedback counts as unanswered when someone
 * left it after your last push, comment or review on the PR.
 */
export function myAction(pr: MyPullRequest, me: string): { reason: string; since: string } | null {
  const mine = [
    pr.lastCommitAt,
    ...pr.feedback.filter((entry) => entry.login === me).map((entry) => entry.at),
  ].filter((at): at is string => Boolean(at));
  const lastActedAt = mine.sort().at(-1) ?? "";
  const unanswered = pr.feedback.filter(
    (entry) => entry.login !== me && isPerson(entry) && entry.at > lastActedAt,
  );
  if (unanswered.length) {
    const people = [...new Set(unanswered.map((entry) => entry.login))];
    const who =
      people.length > 2 ? `${people.slice(0, 2).join(", ")} and others` : people.join(" and ");
    const verb = pr.reviewDecision === "CHANGES_REQUESTED" ? "requested changes" : "left feedback";
    return {
      reason: `${who} ${verb} since your last push or reply`,
      since: unanswered.map((entry) => entry.at).sort()[0] ?? lastActedAt,
    };
  }
  if (pr.isDraft) return null;
  if (pr.checks === "FAILURE" || pr.checks === "ERROR")
    return { reason: "checks failing", since: pr.lastCommitAt ?? "" };
  if (pr.reviewDecision === "APPROVED" && pr.checks === "SUCCESS")
    return { reason: "approved, ready to merge", since: lastActedAt };
  return null;
}
