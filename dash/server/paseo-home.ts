import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Mirrors the daemon's own PASEO_HOME resolution, including a literal `~` from a launchd plist.
function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}

export const pluginDataPath = (file: string) => join(paseoHome(), "plugin-data", "paseo-dash", file);
