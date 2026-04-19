# pi-gotify-notifier

Send [Gotify](https://gotify.net/) push notifications for [pi](https://github.com/badlogic/pi-mono) agent session events.

## Features

- **Task Complete** — notified when the agent finishes processing and is waiting for your input
- **Session Ended** — notified when the pi session shuts down
- **Context Warning** — notified when context usage reaches configurable thresholds (50%, 75%, 90%, 95%)
- **Toggle on/off** — enable or disable all notifications or individual types with the interactive `/gotify` settings panel
- **Editable thresholds** — add, remove, or reset context warning thresholds directly from the settings menu

## Installation

### Via npm

```bash
pi install npm:pi-gotify-notifier
```

### Via git

```bash
pi install git:github.com/mario-gc/pi-gotify-notifier@main
```

### Local development

```bash
pi -e ./path/to/pi-gotify-notifier/src/index.ts
```

## Configuration

Set the following environment variables before starting pi:

| Variable | Required | Description |
|---|---|---|
| `GOTIFY_URL` | Yes | Your Gotify server URL (e.g., `https://gotify.example.com`) |
| `GOTIFY_TOKEN` | Yes | Gotify application token |
| `GOTIFY_ENABLED` | No | Set to `false` or `0` to disable the entire extension at startup (no config loaded, no notifications sent) |
| `GOTIFY_STARTUP_DISABLED` | No | Set to `true` or `1` to load the extension but start with notifications disabled (can be enabled later via `/gotify`) |
| `GOTIFY_TLS_REJECT_UNAUTHORIZED` | No | Set to `false` or `0` to disable TLS verification |
| `GOTIFY_CA_PATH` | No | Path to a custom CA certificate file |
| `GOTIFY_CONTEXT_THRESHOLDS` | No | Comma-separated context usage percentages to warn at (default: `50,75,90,95`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | Fallback for TLS verification (if `GOTIFY_TLS_REJECT_UNAUTHORIZED` is not set) |

### Example

```bash
export GOTIFY_URL="https://gotify.example.com"
export GOTIFY_TOKEN="your-app-token"
pi
```

## How It Works

The extension listens to pi's lifecycle events:

| Event | Notification | Priority |
|---|---|---|
| `agent_end` | ✅ Task Complete | 5 |
| `agent_end` | 🚨 Context Warning (at threshold) | 8 |
| `session_shutdown` | 🔴 Session Ended | 3 |

Thresholds reset after each new session and after compaction.

Notifications are debounced — if multiple agent turns complete in quick succession, only one notification is sent after a short delay.

If the required environment variables are not set, the extension loads silently and does nothing.

## Commands

| Command | Description |
|---|---|
| `/gotify` | Open interactive notification settings |

Type `/gotify` to open a settings panel where you can:
- Toggle all notifications on/off
- Toggle individual notification types (Task Complete, Context Warning, Session Ended)
- Send a test notification
- Add, remove, or reset context warning thresholds (e.g., 50%, 75%, 90%, 95%)

Notification state persists across agent turns and survives `/reload` within the same session.

## License

MIT
