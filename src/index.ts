/**
 * Pi Gotify Notifier Extension
 *
 * Sends Gotify push notifications when pi agent events occur.
 *
 * Environment variables:
 *   GOTIFY_URL                         - Gotify server URL (e.g., https://gotify.example.com)
 *   GOTIFY_TOKEN                       - Gotify app token
 *   GOTIFY_TLS_REJECT_UNAUTHORIZED     - Set to "false" or "0" to disable TLS verification
 *   GOTIFY_CA_PATH                     - Path to custom CA certificate file
 *   GOTIFY_CONTEXT_THRESHOLDS          - Comma-separated context usage percentages to warn at (default: 50,75,90,95)
 *   NODE_TLS_REJECT_UNAUTHORIZED       - Fallback if GOTIFY_TLS_REJECT_UNAUTHORIZED is not set
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as https from "node:https";
import type { Agent } from "node:https";
import { readFile } from "node:fs/promises";

const IDLE_NOTIFY_DELAY_MS = 1000;
const DEFAULT_CONTEXT_THRESHOLDS = [50, 75, 90, 95];

interface GotifyConfig {
  url: string;
  token: string;
  agent: Agent | undefined;
}

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let idleSequence = 0;
let notifiedThresholds = new Set<number>();
let contextThresholds: number[];

function getConfig(): GotifyConfig | null {
  const url = process.env.GOTIFY_URL?.trim();
  const token = process.env.GOTIFY_TOKEN?.trim();

  if (!url || !token) return null;

  const gotifyReject = process.env.GOTIFY_TLS_REJECT_UNAUTHORIZED;
  const nodeReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  let rejectUnauthorized: boolean;
  if (gotifyReject !== undefined) {
    rejectUnauthorized = gotifyReject !== "false" && gotifyReject !== "0";
  } else if (nodeReject !== undefined) {
    rejectUnauthorized = nodeReject !== "false" && nodeReject !== "0";
  } else {
    rejectUnauthorized = true;
  }

  let agent: Agent | undefined;
  if (!rejectUnauthorized) {
    agent = new https.Agent({ rejectUnauthorized: false });
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
    agent,
  };
}

async function loadCustomCa(caPath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(caPath);
  } catch {
    return undefined;
  }
}

async function sendToGotify(
  config: GotifyConfig,
  title: string,
  message: string,
  priority = 5,
): Promise<boolean> {
  const url = `${config.url}/message`;
  const body = JSON.stringify({ title, message, priority });

  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gotify-Key": config.token,
          "Content-Length": Buffer.byteLength(body),
        },
        agent: config.agent,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          resolve(false);
        }
        res.resume();
      },
    );

    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

export default function (pi: ExtensionAPI) {
  const config = getConfig();

  // Parse context thresholds from env or use defaults
  const thresholdsEnv = process.env.GOTIFY_CONTEXT_THRESHOLDS?.trim();
  contextThresholds = thresholdsEnv
    ? thresholdsEnv.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0 && n <= 100)
    : DEFAULT_CONTEXT_THRESHOLDS;

  pi.on("session_start", async (_event, ctx) => {
    if (!config) {
      ctx.ui.notify("Gotify notifier: GOTIFY_URL or GOTIFY_TOKEN not set", "error");
      return;
    }
    notifiedThresholds.clear();
    ctx.ui.notify("Gotify notifier ready", "info");
  });

  pi.on("session_compact", async () => {
    notifiedThresholds.clear();
  });

  if (!config) return;

  // Load custom CA if specified
  const caPath = process.env.GOTIFY_CA_PATH;
  if (caPath) {
    loadCustomCa(caPath).then((ca) => {
      if (ca) {
        config.agent = new https.Agent({ ca });
      }
    });
  }

  pi.on("agent_end", async (_event, ctx) => {
    checkContextThresholds(config!, pi, ctx);

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
    const contextLines = getContextLines(pi, ctx);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    await sendToGotify(
      config,
      "\u{1F534} Session Ended",
      "Pi session has ended" + contextLines,
      3,
    );
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

function checkContextThresholds(
  config: GotifyConfig,
  pi: ExtensionAPI,
  ctx: { cwd: string },
): void {
  const usage = ctx.getContextUsage?.();
  if (!usage) return;

  const model = (ctx as any).model;
  const contextWindow = model?.contextWindow;
  if (!contextWindow) return;

  const pct = Math.round((usage.tokens / contextWindow) * 100);

  for (const threshold of contextThresholds) {
    if (pct >= threshold && !notifiedThresholds.has(threshold)) {
      notifiedThresholds.add(threshold);
      const sessionName = pi.getSessionName?.();
      const lines: string[] = [];
      if (sessionName) lines.push(`Session: ${sessionName}`);
      lines.push(`Project: ${ctx.cwd}`);
      lines.push(`Tokens: ${usage.tokens.toLocaleString()} / ${contextWindow.toLocaleString()}`);
      lines.push(`Estimated remaining: ${(contextWindow - usage.tokens).toLocaleString()}`);

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
