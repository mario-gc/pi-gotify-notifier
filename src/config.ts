/**
 * Configuration types and loading for the Gotify notifier.
 */

import * as https from "node:https";
import type { Agent } from "node:https";
import { readFile } from "node:fs/promises";

export const DEFAULT_CONTEXT_THRESHOLDS = [50, 75, 90, 95];

/** Available notification types. */
export const NOTIFICATION_TYPES = [
  { id: "agentEnd", label: "Task Complete", defaultEnabled: true },
  { id: "contextWarning", label: "Context Warning", defaultEnabled: true },
  { id: "sessionEnd", label: "Session Ended", defaultEnabled: true },
] as const;

export type NotificationTypeId = (typeof NOTIFICATION_TYPES)[number]["id"];

export interface GotifyConfig {
  url: string;
  token: string;
  agent: Agent | undefined;
}

export function loadConfig(): GotifyConfig | null {
  // Check explicit enable/disable flag
  const enabled = process.env.GOTIFY_ENABLED?.trim().toLowerCase();
  if (enabled === "false" || enabled === "0") return null;

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

export async function loadCustomCa(caPath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(caPath);
  } catch {
    return undefined;
  }
}

export function parseContextThresholds(): number[] {
  const thresholdsEnv = process.env.GOTIFY_CONTEXT_THRESHOLDS?.trim();
  if (thresholdsEnv) {
    return thresholdsEnv
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= 100);
  }
  return DEFAULT_CONTEXT_THRESHOLDS;
}
