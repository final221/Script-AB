# Debugging Guide

This guide lists the key log sequences to quickly understand what the healer is doing.

## Capture
- `exportTwitchAdLogs()` to download merged script + console timeline.
- Include both the log file and browser console output.

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
- Offline screen + `[HEALER:ASSET_HINT]` usually means Twitch swapped in an offline/processing element.
- Stalls without `HEALER:START` likely indicate the video never became active or a failover lock is active.
- Repeated `FAILOVER_REVERT` means candidates are present but not progressing; check readiness logs.
