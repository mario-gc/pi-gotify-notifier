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
 *
 * Commands:
 *   /gotify              - Show current notification status
 *   /gotify on           - Enable notifications
 *   /gotify off          - Disable notifications
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as https from "node:https";
import { loadConfig, loadCustomCa, parseContextThresholds } from "./config.js";
import { sendToGotify } from "./gotify.js";
import {
  cancelPendingNotification,
  isEnabled,
  persistState,
  registerHandlers,
  setEnabled,
} from "./handlers.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const contextThresholds = parseContextThresholds();

  // Load custom CA if specified
  if (config) {
    const caPath = process.env.GOTIFY_CA_PATH;
    if (caPath) {
      loadCustomCa(caPath).then((ca) => {
        if (ca && config) {
          config.agent = new https.Agent({ ca });
        }
      });
    }
  }

  // Register lifecycle event handlers
  if (config) {
    registerHandlers(pi, config, contextThresholds);
  } else {
    // Still register session_start to warn about missing config
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("Gotify notifier: GOTIFY_URL or GOTIFY_TOKEN not set", "error");
    });
  }

  // Register the /gotify command
  pi.registerCommand("gotify", {
    description: "Toggle Gotify notifications. Usage: /gotify [on|off|status]",
    handler: async (args, ctx) => {
      if (!config) {
        ctx.ui.notify("Gotify not configured: set GOTIFY_URL and GOTIFY_TOKEN", "error");
        return;
      }

      const action = args?.trim().toLowerCase();

      switch (action) {
        case "on":
          setEnabled(true);
          persistState(pi);
          ctx.ui.notify("Gotify notifications enabled ✓", "info");
          break;

        case "off":
          setEnabled(false);
          cancelPendingNotification();
          persistState(pi);
          ctx.ui.notify("Gotify notifications disabled ✗", "info");
          break;

        case "status":
        case "":
        case undefined: {
          const status = isEnabled() ? "ON ✓" : "OFF ✗";
          ctx.ui.notify(`Gotify notifications: ${status}`, "info");
          break;
        }

        default:
          ctx.ui.notify(
            "Usage: /gotify [on|off|status]\n" +
              "  on      — Enable notifications\n" +
              "  off     — Disable notifications\n" +
              "  status  — Show current status",
            "info",
          );
          break;
      }
    },
  });
}
