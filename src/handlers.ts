/**
 * Event handlers for pi agent lifecycle events.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { GotifyConfig } from "./config.js";
import { sendToGotify } from "./gotify.js";

const IDLE_NOTIFY_DELAY_MS = 1000;

/** Whether notifications are currently enabled (toggled via /gotify command). */
let enabled = true;

/** Thresholds that have already triggered a notification in the current session. */
let notifiedThresholds = new Set<number>();

/** Pending debounce timer for agent_end notifications. */
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/** Sequence counter to cancel stale debounce timers. */
let idleSequence = 0;

export function isEnabled(): boolean {
  return enabled;
}

export function setEnabled(value: boolean): void {
  enabled = value;
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
 * Reconstruct enabled state from session entries (survives /reload).
 */
export function reconstructState(entries: Array<{
  type: string;
  customType?: string;
  data?: { enabled?: boolean; notifiedThresholds?: number[] };
}>): void {
  enabled = true;
  notifiedThresholds = new Set<number>();
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "gotify-state") {
      if (entry.data?.enabled !== undefined) {
        enabled = entry.data.enabled;
      }
      if (entry.data?.notifiedThresholds) {
        notifiedThresholds = new Set(entry.data.notifiedThresholds);
      }
    }
  }
}

/**
 * Persist current state to the session (survives /reload).
 */
export function persistState(pi: ExtensionAPI): void {
  pi.appendEntry("gotify-state", {
    enabled,
    notifiedThresholds: [...notifiedThresholds],
  });
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
  contextThresholds: number[],
): void {
  pi.on("session_start", async (_event, ctx) => {
    // Reconstruct state from session entries (survives /reload)
    const entries = ctx.sessionManager.getEntries();
    reconstructState(
      entries.filter((e) => e.type === "custom" && e.customType === "gotify-state") as Array<{
        type: string;
        customType?: string;
        data?: { enabled?: boolean; notifiedThresholds?: number[] };
      }>,
    );

    if (!config) {
      ctx.ui.notify("Gotify notifier: GOTIFY_URL or GOTIFY_TOKEN not set", "error");
      return;
    }
    notifiedThresholds.clear();
    const status = enabled ? "enabled ✓" : "disabled ✗";
    ctx.ui.notify(`Gotify notifier ready (${status})`, "info");
  });

  pi.on("session_compact", async () => {
    notifiedThresholds.clear();
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled) return;

    checkContextThresholds(config, pi, ctx, contextThresholds);

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
    if (!enabled) return;

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
