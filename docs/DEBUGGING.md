# Debugging Guide

This guide lists the key log sequences to quickly understand what the healer is doing.

## Capture
- `exportTwitchAdLogs()` to download merged script + console timeline.
- `StreamHealer.exportLogs()` or `exportStreamHealerLogs()` to download the same report via the StreamHealer entrypoint.
- Include both the log file and browser console output.
- Firefox: run the command in the page console with the top frame selected (`www.twitch.tv`), then fully reload after updating the userscript so `unsafeWindow` exposure takes effect.

## Common Sequences

### Video discovery and monitoring
Look for:
- `[CORE] New video detected in DOM`
- `[HEALER:VIDEO] Video registered`
- `[HEALER:MONITOR] Started monitoring video`
- `[HEALER:CANDIDATE] Active video set` or `Active video switched`

### Stall detection and healing
Look for:
- `[HEALER:EVENT] waiting` or `stalled`
- `[HEALER:WATCHDOG] No progress observed`
- `[STALL:DETECTED]`
- `[HEALER:START]` -> `[HEALER:POLL_*]` -> `[HEALER:SEEK]` -> `[HEALER:COMPLETE]` or `[HEALER:FAILED]`

### Failover attempts
Look for:
- `[HEALER:FAILOVER] Switching to candidate`
- `[HEALER:FAILOVER_SUCCESS]` or `[HEALER:FAILOVER_REVERT]`

### Reset/ended/offline indicators
Look for:
- `[HEALER:RESET_CHECK]` and `[HEALER:RESET]`
- `[HEALER:ENDED]`
- `[HEALER:ASSET_HINT]` (processing/offline assets)

### External hints (console or network)
Look for:
- `[INSTRUMENT:CONSOLE_HINT]` with type `playhead_stall`
- `[HEALER:STALL_HINT]` with playhead attribution
- `[INSTRUMENT:RESOURCE_HINT]` and `[HEALER:ASSET_HINT]`

### Media state transitions
Look for:
- `[HEALER:MEDIA_STATE] readyState changed`
- `[HEALER:MEDIA_STATE] networkState changed`
- `[HEALER:MEDIA_STATE] src attribute changed`
- `[HEALER:MEDIA_STATE] buffered range count changed`

### Initial progress grace
Look for:
- `[HEALER:WATCHDOG] Awaiting initial progress`
- `[HEALER:WATCHDOG] Initial progress timeout`

## Quick Triage Tips
- If the stream appears offline, treat it as a healing failure first; this crash pattern often follows `POLL_TIMEOUT` -> `NO_HEAL_POINT` -> refresh/switch suppression.
- `[HEALER:ASSET_HINT]` can indicate Twitch swapped in a processing/offline element, but confirm whether the channel is actually live.
- Stalls without `HEALER:START` likely indicate the video never became active or a failover lock is active.
- Repeated `FAILOVER_REVERT` means candidates are present but not progressing; check readiness logs.

## Tuning Cheat Sheet
Use this mapping to connect config knobs to the log lines they influence.

- `stall.INIT_PROGRESS_GRACE_MS`: `[HEALER:WATCHDOG] Awaiting initial progress`, `Initial progress timeout`
- `stall.STALL_CONFIRM_MS` / `STALL_CONFIRM_BUFFER_OK_MS`: `[HEALER:WATCHDOG] No progress observed`
- `stall.FAILOVER_*`: `[HEALER:FAILOVER_*]` entries
- `monitoring.CANDIDATE_*`: `[HEALER:CANDIDATE]` switch/suppress logs
- `monitoring.TRUST_STALE_MS`: candidate snapshot `trustReason: progress_stale`
- `monitoring.PROBE_COOLDOWN_MS`: `[HEALER:PROBE_SKIP] Probe cooldown active`
- `logging.ACTIVE_LOG_MS` / `NON_ACTIVE_LOG_MS`: `[HEALER:WATCHDOG] No progress observed`
- `logging.CONSOLE_SIGNAL_THROTTLE_MS`: `[INSTRUMENT:CONSOLE_HINT]` frequency
- `logging.RESOURCE_HINT_THROTTLE_MS`: `[INSTRUMENT:RESOURCE_HINT]` frequency
