import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { startVim } from "./client/vim/dom";

// The shortcuts the plugin replays are Paseo's macOS desktop defaults.
const isMacDesktop = () => Platform.OS === "web" && /Mac/.test(globalThis.navigator?.platform ?? "");

export default function contribute(_client: PluginClientContext) {
  if (!isMacDesktop()) {
    return () => {};
  }
  return startVim();
}
