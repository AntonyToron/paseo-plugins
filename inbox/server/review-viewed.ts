import type { ReviewFile } from "../shared/review";
import { markViewed } from "./review-github";

const RETRY_DELAY_MS = 2_000;

interface Queue {
  pullRequestId: string;
  /** The mark each path is waiting for, in the order asked. */
  pending: Map<string, boolean>;
  /** Marks GitHub has taken since the file list was last read from it. */
  saved: Map<string, boolean>;
  running: boolean;
  error: string | null;
}

// gh's failure message repeats the whole mutation; its last line is GitHub's answer.
const githubAnswer = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).trim().split("\n").at(-1) ??
  "GitHub refused";

/**
 * Viewed marks on their way to GitHub. GitHub saves a big PR's marks one at a time, a few seconds
 * each, and answers 502 when a request runs past 10s, even three files at once. So marks queue
 * here and go out one per request in the background, and the file list shows them as done
 * meanwhile. A file GitHub refuses twice drops out and shows GitHub's state again.
 */
export class ViewedQueue {
  private queues = new Map<string, Queue>();

  enqueue(key: string, pullRequestId: string, paths: readonly string[], viewed: boolean) {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { pullRequestId, pending: new Map(), saved: new Map(), running: false, error: null };
      this.queues.set(key, queue);
    }
    queue.error = null;
    // Re-adding moves a path to the back with its latest wish.
    for (const path of paths) {
      queue.pending.delete(path);
      queue.pending.set(path, viewed);
    }
    if (!queue.running) void this.drain(queue);
  }

  private async drain(queue: Queue) {
    queue.running = true;
    try {
      for (
        let next = queue.pending.entries().next();
        !next.done;
        next = queue.pending.entries().next()
      ) {
        const [path, viewed] = next.value;
        try {
          await markViewed(queue.pullRequestId, [path], viewed).catch(async () => {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            await markViewed(queue.pullRequestId, [path], viewed);
          });
          queue.saved.set(path, viewed);
        } catch (error) {
          queue.error = githubAnswer(error);
        }
        // Asked again for the other mark while this one ran: it stays queued.
        if (queue.pending.get(path) === viewed) queue.pending.delete(path);
      }
    } finally {
      queue.running = false;
    }
  }

  busy(key: string) {
    return Boolean(this.queues.get(key)?.pending.size);
  }

  /** A fresh read from GitHub has every saved mark in it. */
  forgetSaved(key: string) {
    this.queues.get(key)?.saved.clear();
  }

  /** The files as they'll be once the queue is through, and how far it has to go. */
  overlay(key: string, files: readonly ReviewFile[]) {
    const queue = this.queues.get(key);
    if (!queue) return { files: [...files], marking: 0, markError: null };
    return {
      files: files.map((file) => {
        const wish = queue.pending.get(file.path) ?? queue.saved.get(file.path);
        return wish === undefined
          ? file
          : { ...file, viewed: wish ? ("VIEWED" as const) : ("UNVIEWED" as const) };
      }),
      marking: queue.pending.size,
      markError: queue.error,
    };
  }
}
