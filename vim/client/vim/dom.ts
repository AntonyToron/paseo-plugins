import {
  type Command,
  describePending,
  EMPTY_PENDING,
  feed,
  globalCommand,
  paseoCombo,
  type Pending,
  toToken,
} from "./keymap";
import { type BindingId, type KeyStroke, type Overrides, strokesFor } from "./shortcuts";

// Paseo exposes no plugin API for its pane, tab, or composer state, so this module
// reads the page and replays whatever keys Paseo's own shortcuts are bound to. Selectors
// come from Paseo's test IDs; if a Paseo update breaks a command, start here.
const SELECTORS = {
  composer: "[data-testid='message-input-root']",
  terminal: ".xterm, [data-testid='terminal-surface']",
  chatScroll: "[data-testid='agent-chat-scroll']",
  pane: "[data-testid^='workspace-pane-']",
  paneZoom: "[data-testid='workspace-maximize-pane'], [data-testid='workspace-restore-pane']",
  explorer: "[data-testid='workspace-explorer-sidebar']",
  workspaceRow: "[data-testid^='sidebar-workspace-row-']",
  overlay: "[data-testid='command-center-panel'], [role='dialog'], [role='menu'], [role='listbox']",
};

const ROUTE_POLL_MS = 500;
// The workspace screen needs a moment to mount its sidebar after navigation.
const EXPLORER_SETTLE_MS = 400;

const PANE_FOCUS: Record<string, BindingId> = {
  left: "workspace-pane-focus-left-cmd-shift-left",
  down: "workspace-pane-focus-down-cmd-shift-down",
  up: "workspace-pane-focus-up-cmd-shift-up",
  right: "workspace-pane-focus-right-cmd-shift-right",
};

const OVERRIDES_KEY = "@paseo:keyboard-shortcut-overrides";

const LINE_PX = 40;
// A focus change this soon after a click or Cmd shortcut is the user's, not Paseo's autofocus.
const USER_FOCUS_WINDOW_MS = 500;
const SEQUENCE_TIMEOUT_MS = 1500;

type Context = "normal" | "insert" | "passthrough";

export function startVim(): () => void {
  const synthetic = new WeakSet<Event>();
  let pending: Pending = EMPTY_PENDING;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let wantsNormal = false;
  let userFocusUntil = 0;
  let currentPane: Element | null = null;
  let paseoChordUntil = 0;

  const indicator = createIndicator();

  const resetPending = () => {
    pending = EMPTY_PENDING;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const render = () => {
    const normal = contextOf(document.activeElement) === "normal";
    indicator.style.display = normal ? "block" : "none";
    indicator.textContent = `NORMAL ${describePending(pending)}`.trimEnd();
  };

  const rememberPane = (target: EventTarget | null) => {
    const pane = target instanceof Element ? target.closest(SELECTORS.pane) : null;
    if (pane) {
      currentPane = pane;
    }
  };

  const sendStroke = (stroke: KeyStroke) => {
    const event = new KeyboardEvent("keydown", {
      key: stroke.key,
      code: stroke.code,
      metaKey: stroke.meta,
      ctrlKey: stroke.ctrl,
      shiftKey: stroke.shift,
      altKey: stroke.alt,
      bubbles: true,
      cancelable: true,
    });
    synthetic.add(event);
    (document.activeElement ?? document.body).dispatchEvent(event);
  };

  const sendBinding = (id: BindingId, digit?: number) => {
    const strokes = strokesFor(id, readOverrides(), digit);
    debug("send", { id, strokes });
    strokes?.forEach(sendStroke);
  };

  const enterNormal = () => {
    wantsNormal = true;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      rememberPane(active);
      active.blur();
    }
    debug("enter normal", { blurred: describe(active), nowFocused: describe(document.activeElement) });
    render();
  };

  const run = (command: Command) => {
    switch (command.kind) {
      case "scroll": {
        const scroller = chatScroller(currentPane);
        if (!scroller) return;
        const step = {
          line: LINE_PX,
          "half-page": scroller.clientHeight / 2,
          page: scroller.clientHeight * 0.9,
        }[command.unit];
        scroller.scrollBy({
          top: command.sign * step * command.times,
          behavior: command.unit === "line" ? "auto" : "smooth",
        });
        return;
      }
      case "scroll-to": {
        const scroller = chatScroller(currentPane);
        if (!scroller) return;
        scroller.scrollTo({ top: command.edge === "top" ? 0 : scroller.scrollHeight });
        return;
      }
      case "tab":
        for (let i = 0; i < command.times; i++) {
          sendBinding(
            command.sign > 0
              ? "workspace-tab-navigate-relative-alt-shift-right"
              : "workspace-tab-navigate-relative-alt-shift-left",
          );
        }
        return;
      case "tab-index":
        if (command.index >= 1 && command.index <= 9) {
          sendBinding("workspace-tab-navigate-index-cmd-alt-digit-mac-desktop", command.index);
        }
        return;
      case "workspace": {
        // Paseo's own next/previous workspace shortcut only cycles the first 9 sidebar rows.
        const next = adjacentWorkspaceRow(command.sign);
        if (next) {
          next.click();
          next.scrollIntoView({ block: "nearest" });
        } else {
          sendBinding(
            command.sign > 0
              ? "workspace-navigate-relative-cmd-right-mac"
              : "workspace-navigate-relative-cmd-left-mac",
          );
        }
        return;
      }
      case "pane-focus":
        sendBinding(PANE_FOCUS[command.direction]);
        return;
      case "pane-split":
        sendBinding(
          command.direction === "down"
            ? "workspace-pane-split-down-cmd-shift-backslash"
            : "workspace-pane-split-right-cmd-backslash",
        );
        return;
      case "pane-close":
        sendBinding("workspace-pane-close-cmd-shift-w");
        return;
      case "pane-zoom": {
        const button = currentPane?.querySelector(SELECTORS.paneZoom);
        if (button instanceof HTMLElement) button.click();
        return;
      }
      case "insert":
        wantsNormal = false;
        userFocusUntil = Date.now() + USER_FOCUS_WINDOW_MS;
        sendBinding("message-input-focus-cmd-l-mac");
        return;
      case "command-center":
        sendBinding("command-center-toggle-cmd-k-mac");
        return;
      case "files":
        sendBinding("workspace-project-pick-cmd-p-mac");
        return;
      case "find":
        // Find is a fixed Cmd+F policy in Paseo, not a rebindable shortcut.
        sendStroke({ key: "f", code: "KeyF", meta: true, ctrl: false, alt: false, shift: false });
        return;
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (synthetic.has(event) || event.isComposing) return;
    if (event.metaKey) {
      userFocusUntil = Date.now() + USER_FOCUS_WINDOW_MS;
    }
    const context = contextOf(event.target);
    const token = toToken(event);
    debug("keydown", { key: event.key, token, context, target: describe(event.target) });
    if (token === null) return;

    // The key after a Paseo chord prefix (like Ctrl+A in `Ctrl+A J`) belongs to Paseo.
    if (Date.now() < paseoChordUntil) {
      paseoChordUntil = 0;
      resetPending();
      return;
    }
    if (isPaseoChordPrefix(token)) {
      paseoChordUntil = Date.now() + SEQUENCE_TIMEOUT_MS;
      return;
    }

    const global = globalCommand(token);
    if (global && !visibleMatch(SELECTORS.overlay) && !paseoBindsToken(token)) {
      event.preventDefault();
      event.stopPropagation();
      resetPending();
      run(global);
      render();
      return;
    }

    // Like vim, Esc and Ctrl-c leave insert mode even when they also close a completion menu.
    // Ctrl-c is the one that leaves a running agent alone: Paseo interrupts on Esc.
    if (context === "insert" && (token === "<Esc>" || token === "<C-c>")) {
      if (token === "<C-c>") event.preventDefault();
      enterNormal();
      return;
    }
    if (context !== "normal") {
      resetPending();
      return;
    }
    if (token === "<Esc>") {
      resetPending();
      render();
      return;
    }

    const result = feed(pending, token);
    if (result.type === "unmapped") {
      if (result.aborted) {
        event.preventDefault();
        event.stopPropagation();
      }
      resetPending();
      render();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resetPending();
    if (result.type === "pending") {
      pending = result.pending;
      pendingTimer = setTimeout(() => {
        resetPending();
        render();
      }, SEQUENCE_TIMEOUT_MS);
    } else {
      run(result.command);
    }
    render();
  };

  const onPointerDown = (event: PointerEvent) => {
    userFocusUntil = Date.now() + USER_FOCUS_WINDOW_MS;
    rememberPane(event.target);
  };

  const onFocusIn = (event: FocusEvent) => {
    rememberPane(event.target);
    const enteringComposer = contextOf(event.target) === "insert";
    const autofocused = enteringComposer && wantsNormal && Date.now() > userFocusUntil;
    debug("focusin", { target: describe(event.target), enteringComposer, autofocused });
    if (autofocused && event.target instanceof HTMLElement) {
      event.target.blur();
    } else if (enteringComposer) {
      wantsNormal = false;
    }
    render();
  };

  const onFocusOut = () => {
    setTimeout(render, 0);
  };

  // Paseo remembers the explorer sidebar per workspace; reopen it on every navigation.
  let lastPath = "";
  const routePoll = setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    setTimeout(() => {
      const onWorkspace = document.querySelector(SELECTORS.pane) !== null;
      const explorerOpen = visibleMatch(SELECTORS.explorer) !== null;
      debug("route", { path: lastPath, onWorkspace, explorerOpen });
      if (onWorkspace && !explorerOpen) {
        sendBinding("sidebar-toggle-right-cmd-e-mac");
      }
    }, EXPLORER_SETTLE_MS);
  }, ROUTE_POLL_MS);

  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.body.appendChild(indicator);
  render();

  return () => {
    resetPending();
    clearInterval(routePoll);
    window.removeEventListener("keydown", onKeyDownCapture, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    indicator.remove();
  };
}

function contextOf(target: EventTarget | null): Context {
  const element = target instanceof Element ? target : document.body;
  if (element.closest(SELECTORS.composer)) return "insert";
  if (element.closest(SELECTORS.terminal)) return "passthrough";
  if (isEditable(element)) return "passthrough";
  if (visibleMatch(SELECTORS.overlay)) return "passthrough";
  return "normal";
}

/** The sidebar row before or after the selected one, wrapping around; null if the sidebar is hidden. */
function adjacentWorkspaceRow(sign: 1 | -1): HTMLElement | null {
  const seen = new Set<string>();
  const rows = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.workspaceRow)).filter((row) => {
    const id = row.getAttribute("data-testid") ?? "";
    if (seen.has(id) || row.getClientRects().length === 0) return false;
    seen.add(id);
    return true;
  });
  const current = rows.findIndex((row) => row.getAttribute("aria-selected") === "true");
  if (current === -1) return null;
  return rows[(current + sign + rows.length) % rows.length] ?? null;
}

function isPaseoChordPrefix(token: string): boolean {
  const combo = paseoCombo(token)?.toLowerCase();
  if (combo === undefined) return false;
  return Object.values(readOverrides()).some(
    (value) =>
      typeof value === "string" && value.includes(" ") && value.split(" ")[0].toLowerCase() === combo,
  );
}

// Paseo runs its own handler first, so a key it still binds would fire twice.
function paseoBindsToken(token: string | null): boolean {
  const combo = token === null ? null : paseoCombo(token);
  if (combo === null) return false;
  return Object.values(readOverrides()).some(
    (value) => typeof value === "string" && value.toLowerCase() === combo.toLowerCase(),
  );
}

// Paseo keeps shortcut overrides in AsyncStorage, which is localStorage on desktop.
function readOverrides(): Overrides {
  const raw = localStorage.getItem(OVERRIDES_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Overrides) : {};
  } catch {
    return {};
  }
}

function visibleMatch(selector: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (element) => element.getClientRects().length > 0,
    ) ?? null
  );
}

// Enable from DevTools with localStorage.setItem("paseo-vim:debug", "1").
function debug(message: string, details: Record<string, unknown>) {
  if (localStorage.getItem("paseo-vim:debug") === "1") {
    console.debug(`[paseo-vim] ${message}`, details);
  }
}

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return String(target);
  const testId = target.closest("[data-testid]")?.getAttribute("data-testid");
  return `${target.tagName.toLowerCase()}${testId ? ` in ${testId}` : ""}`;
}

function isEditable(element: Element): boolean {
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function isVisible(element: HTMLElement): boolean {
  return element.offsetParent !== null && element.clientHeight > 0;
}

function chatScroller(currentPane: Element | null): HTMLElement | null {
  const visible = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.chatScroll)).filter(isVisible);
  if (currentPane?.isConnected) {
    const inPane = visible.find((element) => currentPane.contains(element));
    if (inPane) return inPane;
  }
  return visible.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ?? null;
}

function createIndicator(): HTMLDivElement {
  const indicator = document.createElement("div");
  Object.assign(indicator.style, {
    position: "fixed",
    right: "12px",
    bottom: "8px",
    zIndex: "2147483647",
    pointerEvents: "none",
    padding: "2px 6px",
    borderRadius: "4px",
    font: "600 11px ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: "0.04em",
    background: "rgba(128, 128, 128, 0.22)",
    color: "rgba(128, 128, 128, 0.95)",
  });
  return indicator;
}
