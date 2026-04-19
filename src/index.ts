/**
 * Pi Gotify Notifier Extension
 *
 * Sends Gotify push notifications when pi agent events occur.
 *
 * Environment variables:
 *   GOTIFY_URL                         - Gotify server URL (e.g., https://gotify.example.com)
 *   GOTIFY_TOKEN                       - Gotify app token
 *   GOTIFY_ENABLED                     - Set to "false" or "0" to disable the entire extension
 *   GOTIFY_STARTUP_DISABLED            - Set to "true" or "1" to load extension but start with notifications off
 *   GOTIFY_TLS_REJECT_UNAUTHORIZED     - Set to "false" or "0" to disable TLS verification
 *   GOTIFY_CA_PATH                     - Path to custom CA certificate file
 *   GOTIFY_CONTEXT_THRESHOLDS          - Comma-separated context usage percentages to warn at (default: 50,75,90,95)
 *   NODE_TLS_REJECT_UNAUTHORIZED       - Fallback if GOTIFY_TLS_REJECT_UNAUTHORIZED is not set
 *
 * Commands:
 *   /gotify  — Open interactive notification settings
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type Component, type SettingItem, SettingsList, matchesKey, Key } from "@mariozechner/pi-tui";
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
  getThresholds,
  getState,
  persistState,
  registerHandlers,
  setGlobalEnabled,
  setNotificationEnabled,
  setThresholds,
} from "./handlers.js";

/** Build a SettingsList component for the notification toggles submenu. */
function buildNotificationsSubmenu(
  theme: ReturnType<typeof getSettingsListTheme>,
  persist: () => void,
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
    },
    done,
  );
}

/** Build a SettingsList component for the test notification submenu. */
function buildTestSubmenu(
  theme: ReturnType<typeof getSettingsListTheme>,
  config: NonNullable<ReturnType<typeof loadConfig>>,
  notify: (msg: string, type: "info" | "error") => void,
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
        });
      }
    },
    done,
  );
}

/** Build a dynamic SettingsList component for the context thresholds submenu. */
function buildThresholdsSubmenu(
  theme: ReturnType<typeof getSettingsListTheme>,
  persist: () => void,
  done: () => void,
  notify: (msg: string, type: "info" | "error" | "warning") => void,
): Component {
  let settingsList: SettingsList;
  let inputMode = false;
  let inputBuffer = "";

  function buildList(targetIndex?: number): SettingsList {
    const current = getThresholds();

    const items: SettingItem[] = current.map((t) => ({
      id: String(t),
      label: `${t}%`,
      currentValue: "remove",
      values: ["remove"],
      description: `Remove the ${t}% context warning threshold`,
    }));

    const addIndex = items.length;

    items.push({
      id: "__add",
      label: inputMode ? `Enter value: ${inputBuffer || "_"}` : "Add threshold...",
      currentValue: inputMode ? "typing" : "→",
      values: ["→"],
      description: inputMode ? "Type digits, Enter to submit, Esc to cancel" : "Add a new context usage warning threshold (1-100%)",
    });

    items.push({
      id: "__reset",
      label: "Reset to defaults",
      currentValue: "→",
      values: ["→"],
      description: `Restore default thresholds: ${[50, 75, 90, 95].join(", ")}%`,
    });

    const list = new SettingsList(
      items,
      Math.min(items.length + 2, 10),
      theme,
      (id, newValue) => {
        if (id === "__reset" && newValue === "→") {
          setThresholds([50, 75, 90, 95]);
          persist();
          notify("Thresholds reset to defaults", "info");
          settingsList = buildList(addIndex);
          return;
        }
        if (id === "__add" && newValue === "→" && !inputMode) {
          inputMode = true;
          inputBuffer = "";
          settingsList = buildList(addIndex);
          return;
        }
        if (newValue === "remove") {
          const threshold = parseInt(id, 10);
          if (!isNaN(threshold)) {
            const next = getThresholds().filter((t) => t !== threshold);
            setThresholds(next);
            persist();
            settingsList = buildList(Math.min(addIndex - 1, next.length));
          }
        }
      },
      done,
    );

    if (targetIndex !== undefined) {
      (list as any).selectedIndex = Math.min(targetIndex, items.length - 1);
    }

    return list;
  }

  settingsList = buildList(getThresholds().length);

  return {
    render(width: number) {
      return settingsList.render(width);
    },
    invalidate() {
      settingsList.invalidate();
    },
    handleInput(data: string) {
      if (inputMode) {
        // Digits: "0" through "9"
        if (/^[0-9]$/.test(data)) {
          if (inputBuffer.length < 3) {
            inputBuffer += data;
            settingsList = buildList(getThresholds().length);
          }
          return;
        }
        if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
          inputBuffer = inputBuffer.slice(0, -1);
          settingsList = buildList(getThresholds().length);
          return;
        }
        if (matchesKey(data, Key.enter) || data === " ") {
          if (inputBuffer) {
            const value = parseInt(inputBuffer, 10);
            const current = getThresholds();
            if (value < 1 || value > 100) {
              notify("Threshold must be between 1 and 100", "error");
            } else if (current.includes(value)) {
              notify(`Threshold ${value}% already exists`, "warning");
            } else {
              setThresholds([...current, value]);
              persist();
              notify(`Added ${value}% threshold`, "info");
            }
          }
          inputMode = false;
          inputBuffer = "";
          settingsList = buildList(getThresholds().length);
          return;
        }
        if (matchesKey(data, Key.escape)) {
          inputMode = false;
          inputBuffer = "";
          settingsList = buildList(getThresholds().length);
          return;
        }
        return;
      }
      settingsList.handleInput(data);
    },
  };
}

/** Build the main menu. Pass an onStateChange callback to trigger rebuilds. */
function buildMainMenu(
  tuiTheme: Theme,
  settingsTheme: ReturnType<typeof getSettingsListTheme>,
  config: NonNullable<ReturnType<typeof loadConfig>>,
  persist: () => void,
  notify: (msg: string, type: "info" | "error" | "warning") => void,
  done: () => void,
  onRebuild: (comp: Component) => void,
): Component {
  const state = getState();
  const thresholds = getThresholds();

  const items: SettingItem[] = [
    {
      id: "notifications",
      label: "Notifications",
      currentValue: "submenu",
      description: "Toggle individual notification types on or off",
      submenu: (_currentValue, subDone) => {
        return buildNotificationsSubmenu(
          settingsTheme,
          persist,
          () => {
            subDone();
            // After returning from submenu, rebuild main menu to reflect state changes
            onRebuild(buildMainMenu(tuiTheme, settingsTheme, config, persist, notify, done, onRebuild));
          },
        );
      },
    },
    {
      id: "test",
      label: "Test Notification",
      currentValue: "submenu",
      description: "Send a test notification to verify your Gotify setup",
      submenu: (_currentValue, subDone) =>
        buildTestSubmenu(settingsTheme, config, notify, () => {
          subDone();
          onRebuild(buildMainMenu(tuiTheme, settingsTheme, config, persist, notify, done, onRebuild));
        }),
    },
    {
      id: "thresholds",
      label: "Context Thresholds",
      currentValue: `${thresholds.join(", ")}%`,
      description: "Context usage percentages that trigger a warning notification",
      submenu: (_currentValue, subDone) =>
        buildThresholdsSubmenu(settingsTheme, persist, () => {
          subDone();
          onRebuild(buildMainMenu(tuiTheme, settingsTheme, config, persist, notify, done, onRebuild));
        }, notify),
    },
  ];

  const container = new Container();
  container.addChild(
    new (class {
      render(_width: number) {
        return [tuiTheme.fg("accent", tuiTheme.bold("Gotify Notifications")), ""];
      }
      invalidate() {}
    })(),
  );

  const settingsList = new SettingsList(
    items,
    Math.min(items.length + 2, 8),
    settingsTheme,
    () => {},
    () => {
      done();
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
      settingsList.handleInput(data);
    },
  };
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
        const settingsTheme = getSettingsListTheme();
        const notify = ctx.ui.notify.bind(ctx.ui);

        let current: Component = buildMainMenu(
          theme,
          settingsTheme,
          config,
          persist,
          notify,
          () => { done(undefined as never); },
          (next) => { current = next; },
        );

        return {
          render(width: number) {
            return current.render(width);
          },
          invalidate() {
            current.invalidate();
          },
          handleInput(data: string) {
            current.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });
}
