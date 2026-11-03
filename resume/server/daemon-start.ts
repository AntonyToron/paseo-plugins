import { execCommand } from "@getpaseo/plugin/server";

let cached: Promise<number> | null = null;

/**
 * When the daemon worker that spawned this plugin process started. A chat that went quiet
 * mid-turn before then was cut off by the restart; one that went quiet since is still live,
 * for example idle while its background subagents finish.
 */
export function daemonStartedAt(): Promise<number> {
  cached ??= execCommand("ps", ["-o", "lstart=", "-p", String(process.ppid)]).then(({ stdout }) => {
    const startedAt = Date.parse(stdout.trim());
    if (Number.isNaN(startedAt)) throw new Error(`Couldn't read the daemon's start time from ps: "${stdout.trim()}"`);
    return startedAt;
  });
  return cached;
}
