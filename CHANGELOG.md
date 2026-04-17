# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-04-17

### Added

- `/gotify` command to toggle notifications on and off (`/gotify on`, `/gotify off`, `/gotify status`)
- Notification state persists across turns and survives `/reload` via session entries
- Codebase refactored into modular structure (`config.ts`, `gotify.ts`, `handlers.ts`)

## [0.3.0] - 2026-04-17

### Added

- Context usage warning notifications at configurable thresholds (default: 50%, 75%, 90%, 95%)
- `GOTIFY_CONTEXT_THRESHOLDS` environment variable to customize warning thresholds
- Thresholds reset on new session and after compaction
- Model info (provider/id) included in context warning notifications
## [0.2.1] - 2026-04-17

### Added

- `session_start` notification confirming the extension is loaded and ready

## [0.2.0] - 2026-04-16

### Added

- Session name and project path in notifications

## [0.1.0] - 2026-04-16

### Added

- Gotify notifications for pi agent events
  - **Task Complete** — notified when the agent finishes processing
  - **Session Ended** — notified when the pi session shuts down
- TLS configuration via `GOTIFY_TLS_REJECT_UNAUTHORIZED` and `GOTIFY_CA_PATH`
- Silent no-op when environment variables are not set
- Debounced notifications to avoid spam during rapid turns

[Unreleased]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mario-gc/pi-gotify-notifier/releases/tag/v0.1.0
