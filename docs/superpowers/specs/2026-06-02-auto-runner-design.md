# Auto Runner Mode — Design Spec

## Summary

Orbit orchestrates scheduled and manual `/auto-run` prompts to Antigravity IDE. GitHub issue triage and implementation use **GitHub MCP** inside the `auto-run.md` workflow. Telegram notifies on start and after the run window.

## Behavior

- **Ignite-gated UI:** Auto runner tab visible when CDP is available (`findRespondingCdpPort`).
- **Scheduled:** Toggle enables polling every **5 minutes** (fixed). Fires once per model per reset cycle in the window `[resetTime - leadTime, resetTime)` (default lead 1h).
- **Manual Run now:** Model dropdown (Auto + quota models). Does not set `lastFired`.
- **Concurrency:** One global `inFlight` run.
- **Prompt:** `orbitprompter prompt --text "..." [--model id]` (≥ 1.0.3).
- **Completion Telegram:** After `runTimeoutMinutes`, re-fetch quota and message remaining % and next reset.

## Workflow labels

- `orbit:auto-in-progress` / `orbit:auto-done` for duplicate issue guard.

## Config

`~/.remoat/config.json` → `autoRunner`: `{ enabled, leadTimeBeforeResetHours, runTimeoutMinutes }`

State: `~/.remoat/auto-runner-state.json`

## Future

- System tray so scheduler runs when window minimized.
- `orbitprompter prompt --wait` for accurate completion timing.
