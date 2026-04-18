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
 *   /gotify  — Open interactive notification settings
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type Component, type SettingItem, SettingsList } from "@mariozechner/pi-tui";
import * as https from "node:https";
import {
  loadConfig,
  loadCustomCa,
  NOTIFICATION_TYPES,
  parseContextThresholds,
  type NotificationTypeId,
} from "./config.js";
import { sendToGotify } from "./gotify.js";
import {
  getState,
  persistState,
  registerHandlers,
  setGlobalEnabled,
  setNotificationEnabled,
} from "./handlers.js";

/** Build a SettingsList component for the notification toggles submenu. */
function buildNotificationsSubmenu(
  theme: ReturnType<typeof getSettingsListTheme>,
  persist: () => void,
  invalidate: () => void,
  done: () => void,
): Component {
  const state = getState();
  const items: SettingItem[] = [
    {
      id: "__global",
      label: "All Notifications",
      currentValue: state.globalEnabled ? "enabled" : "disabled",
      values: ["enabled", "disabled"],
      description: "Master switch for all Gotify notifications",
    },
  ];

  const descriptions: Record<NotificationTypeId, string> = {
    agentEnd: "Notify when the agent finishes processing a task",
    contextWarning: "Notify when context usage reaches configured thresholds",
    sessionEnd: "Notify when the pi session shuts down",
  };

  for (const nt of NOTIFICATION_TYPES) {
    items.push({
      id: nt.id,
      label: nt.label,
      currentValue: state.notifications[nt.id] ? "enabled" : "disabled",
      values: ["enabled", "disabled"],
      description: descriptions[nt.id],
    });
  }

  return new SettingsList(
    items,
    Math.min(items.length + 2, 10),
    theme,
    (id, newValue) => {
      if (id === "__global") {
        setGlobalEnabled(newValue === "enabled");
      } else {
        setNotificationEnabled(id as NotificationTypeId, newValue === "enabled");
      }
      persist();
      invalidate();
    },
    done,
  );
}

/** Build a SettingsList component for the test notification submenu. */
function buildTestSubmenu(
  theme: ReturnType<typeof getSettingsListTheme>,
  config: NonNullable<ReturnType<typeof loadConfig>>,
  notify: (msg: string, type: "info" | "error") => void,
  invalidate: () => void,
  done: () => void,
): Component {
  const items: SettingItem[] = [
    {
      id: "__send",
      label: "Send Test Notification",
      currentValue: "→",
      values: ["→"],
    },
  ];

  return new SettingsList(
    items,
    3,
    theme,
    (id) => {
      if (id === "__send") {
        sendToGotify(config, "\u{1F9EA} Test", "Gotify notifier is working!", 5).then((ok) => {
          notify(ok ? "Test notification sent" : "Failed to send test notification", ok ? "info" : "error");
          invalidate();
        });
      }
    },
    done,
  );
}

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
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify("Gotify notifier: GOTIFY_URL or GOTIFY_TOKEN not set", "error");
    });
  }

  // Register the interactive /gotify command
  pi.registerCommand("gotify", {
    description: "Open Gotify notification settings",
    handler: async (_args, ctx) => {
      if (!config) {
        ctx.ui.notify("Gotify not configured: set GOTIFY_URL and GOTIFY_TOKEN", "error");
        return;
      }

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const persist = () => persistState(pi);
        const invalidate = () => tui.requestRender();
        const settingsTheme = getSettingsListTheme();

        // Main menu items with submenus
        const items: SettingItem[] = [
          {
            id: "notifications",
            label: "Notifications",
            currentValue: "submenu",
            description: "Toggle individual notification types on or off",
            submenu: (_currentValue, subDone) =>
              buildNotificationsSubmenu(settingsTheme, persist, invalidate, subDone),
          },
          {
            id: "test",
            label: "Test Notification",
            currentValue: "submenu",
            description: "Send a test notification to verify your Gotify setup",
            submenu: (_currentValue, subDone) =>
              buildTestSubmenu(settingsTheme, config, ctx.ui.notify.bind(ctx.ui), invalidate, subDone),
          },
          {
            id: "thresholds",
            label: "Context Thresholds",
            currentValue: `${contextThresholds.join(", ")}%`,
            description: "Context usage percentages that trigger a warning notification (set via GOTIFY_CONTEXT_THRESHOLDS)",
          },
        ];

        const container = new Container();
        container.addChild(
          new (class {
            render(_width: number) {
              return [theme.fg("accent", theme.bold("Gotify Notifications")), ""];
            }
            invalidate() {}
          })(),
        );

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 8),
          settingsTheme,
          (_id, _newValue) => {
            // No direct toggle on main menu — everything uses submenus or is read-only
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });
}
