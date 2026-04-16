# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-16

### Added

- Gotify notifications for pi agent events
  - **Task Complete** — notified when the agent finishes processing
  - **Session Ended** — notified when the pi session shuts down
- Session context in notifications (session name and project path)
- TLS configuration via `GOTIFY_TLS_REJECT_UNAUTHORIZED` and `GOTIFY_CA_PATH`
- Silent no-op when environment variables are not set
- Debounced notifications to avoid spam during rapid turns

[Unreleased]: https://github.com/mario-gc/pi-gotify-notifier/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mario-gc/pi-gotify-notifier/releases/tag/v0.1.0
