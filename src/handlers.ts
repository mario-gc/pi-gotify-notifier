/**
 * Event handlers for pi agent lifecycle events.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { GotifyConfig, NotificationTypeId } from "./config.js";
import { DEFAULT_CONTEXT_THRESHOLDS } from "./config.js";
import { sendToGotify } from "./gotify.js";

const IDLE_NOTIFY_DELAY_MS = 1000;

/** Per-notification toggle state. */
interface NotificationState {
  globalEnabled: boolean;
  notifications: Record<NotificationTypeId, boolean>;
  thresholds: number[];
}

/** Default notification state. */
const DEFAULT_STATE: NotificationState = {
  globalEnabled: true,
  notifications: {
    agentEnd: true,
    contextWarning: true,
    sessionEnd: true,
  },
  thresholds: [...DEFAULT_CONTEXT_THRESHOLDS],
};

/** Current notification state. */
let state: NotificationState = { ...DEFAULT_STATE, notifications: { ...DEFAULT_STATE.notifications } };

/** Thresholds that have already triggered a notification in the current session. */
let notifiedThresholds = new Set<number>();

/** Pending debounce timer for agent_end notifications. */
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/** Sequence counter to cancel stale debounce timers. */
let idleSequence = 0;

export function getState(): NotificationState {
  return state;
}

export function setGlobalEnabled(value: boolean): void {
  state.globalEnabled = value;
}

export function setNotificationEnabled(id: NotificationTypeId, value: boolean): void {
  state.notifications[id] = value;
}

export function getThresholds(): number[] {
  return [...state.thresholds];
}

export function setThresholds(thresholds: number[]): void {
  state.thresholds = [...thresholds].sort((a, b) => a - b);
}

export function resetThresholds(): void {
  notifiedThresholds.clear();
}

export function getNotifiedThresholds(): Set<number> {
  return notifiedThresholds;
}

export function cancelPendingNotification(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
}

/**
 * Reconstruct state from session entries (survives /reload).
 */
export function reconstructState(
  entries: Array<{
    type: string;
    customType?: string;
    data?: Partial<NotificationState>;
  }>,
  fallbackThresholds: number[],
): void {
  state = {
    ...DEFAULT_STATE,
    notifications: { ...DEFAULT_STATE.notifications },
    thresholds: [...fallbackThresholds],
  };
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "gotify-state") {
      const data = entry.data;
      if (!data) continue;
      if (data.globalEnabled !== undefined) {
        state.globalEnabled = data.globalEnabled;
      }
      if (data.notifications) {
        for (const key of Object.keys(data.notifications) as NotificationTypeId[]) {
          state.notifications[key] = data.notifications[key]!;
        }
      }
      if (data.thresholds && data.thresholds.length > 0) {
        state.thresholds = [...data.thresholds].sort((a, b) => a - b);
      }
    }
  }
}

/**
 * Persist current state to the session (survives /reload).
 */
export function persistState(pi: ExtensionAPI): void {
  pi.appendEntry("gotify-state", { ...state, notifiedThresholds: [...notifiedThresholds] });
}

function getContextLines(pi: ExtensionAPI, ctx: { cwd: string }): string {
  const lines: string[] = [];
  const sessionName = pi.getSessionName?.();
  if (sessionName) {
    lines.push("");
    lines.push(`Session: ${sessionName}`);
  }
  lines.push("");
  lines.push(`Project: ${ctx.cwd}`);
  return lines.join("\n");
}

export function registerHandlers(
  pi: ExtensionAPI,
  config: GotifyConfig,
  envThresholds: number[],
): void {
  pi.on("session_start", async (_event, ctx) => {
    // Reconstruct state from session entries (survives /reload)
    const entries = ctx.sessionManager.getBranch();
    const customEntries = entries.filter(
      (e) => e.type === "custom" && e.customType === "gotify-state",
    ) as Array<{ type: string; customType?: string; data?: Partial<NotificationState> }>;
    reconstructState(customEntries, envThresholds);

    if (!config) {
      ctx.ui.notify("Gotify notifier: GOTIFY_URL or GOTIFY_TOKEN not set", "error");
      return;
    }
    notifiedThresholds.clear();
    const status = state.globalEnabled ? "enabled ✓" : "disabled ✗";
    ctx.ui.notify(`Gotify notifier ready (${status})`, "info");
  });

  pi.on("session_compact", async () => {
    notifiedThresholds.clear();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!state.globalEnabled || !state.notifications.agentEnd) return;

    checkContextThresholds(config, pi, ctx, state.thresholds);

    const contextLines = getContextLines(pi, ctx);
    idleSequence++;
    const seq = idleSequence;

    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(async () => {
      if (idleSequence !== seq) return;
      pendingTimer = undefined;
      await sendToGotify(
        config,
        "\u2705 Task Complete",
        "Pi agent finished processing" + contextLines,
        5,
      );
    }, IDLE_NOTIFY_DELAY_MS);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!state.globalEnabled || !state.notifications.sessionEnd) return;

    const contextLines = getContextLines(pi, ctx);
    cancelPendingNotification();
    await sendToGotify(
      config,
      "\u{1F534} Session Ended",
      "Pi session has ended" + contextLines,
      3,
    );
  });
}

function checkContextThresholds(
  config: GotifyConfig,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  thresholds: number[],
): void {
  if (!state.globalEnabled || !state.notifications.contextWarning) return;

  const usage = ctx.getContextUsage?.();
  if (!usage || !usage.tokens) return;

  const contextWindow = ctx.model?.contextWindow;
  if (!contextWindow) return;

  const pct = Math.round((usage.tokens / contextWindow) * 100);

  for (const threshold of thresholds) {
    if (pct >= threshold && !notifiedThresholds.has(threshold)) {
      notifiedThresholds.add(threshold);
      const sessionName = pi.getSessionName?.();
      const modelStr = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const lines: string[] = [];
      if (sessionName) lines.push(`Session: ${sessionName}`);
      if (modelStr) lines.push(`Model: ${modelStr}`);
      lines.push(`Project: ${ctx.cwd}`);
      lines.push(`Tokens: ${usage.tokens!.toLocaleString()} / ${contextWindow.toLocaleString()}`);
      lines.push(`Estimated remaining: ${(contextWindow - usage.tokens!).toLocaleString()}`);

      sendToGotify(
        config,
        `\u{1F6A8} Context Warning: ${pct}%`,
        `Session is at ${pct}% of context window (${threshold}% threshold)\n` +
          lines.join("\n"),
        8,
      );
    }
  }
}
