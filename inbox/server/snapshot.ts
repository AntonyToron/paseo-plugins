import type { InboxItem, InboxSnapshot } from "../shared/model";
import { myAction, sortReviewRequests } from "../shared/model";
import { me, myPullRequests, reviewRequests } from "./github";
import { Triager } from "./triage";

const CACHE_MS = 2 * 60_000;

let cached: { at: number; settled: boolean; snapshot: Promise<InboxSnapshot> } | null = null;
const triager = new Triager();

async function build(): Promise<InboxSnapshot> {
  const [requests, mine, login] = await Promise.all([reviewRequests(), myPullRequests(), me()]);
  const now = Date.now();
  const triage = await triager.results(requests, now);
  const sorted = sortReviewRequests(requests, now, triage.results);
  const actions: InboxItem[] = [];
  for (const pr of mine) {
    const action = myAction(pr, login);
    if (!action) continue;
    actions.push({
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: login,
      reason: action.reason,
      since: action.since,
      kind: "mine",
      slackUrl: null,
    });
  }
  // Unanswered feedback first, then failing checks, then PRs ready to merge.
  const order = (item: InboxItem) =>
    item.reason.includes("since your last") ? 0 : item.reason === "checks failing" ? 1 : 2;
  return {
    ...sorted,
    mine: actions.sort((a, b) => order(a) - order(b) || a.since.localeCompare(b.since)),
    quietMine: mine.length - actions.length,
    triage: { pending: triage.pending, error: triage.error },
    fetchedAt: new Date(now).toISOString(),
  };
}

/**
 * GitHub's search API is rate limited, so every client shares one answer for a couple of
 * minutes. A refresh skips that, but joins one already in flight rather than starting another.
 */
export function getSnapshot(refresh = false): Promise<InboxSnapshot> {
  const stale = !cached || Date.now() - cached.at > CACHE_MS;
  if (stale || (refresh && cached?.settled)) {
    const entry = { at: Date.now(), settled: false, snapshot: build() };
    entry.snapshot.then(
      () => {
        entry.settled = true;
      },
      () => {
        if (cached === entry) cached = null;
      },
    );
    cached = entry;
  }
  return (cached as NonNullable<typeof cached>).snapshot;
}
