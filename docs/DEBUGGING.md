# Debugging Guide

This guide lists the key log sequences to quickly understand what the healer is doing.

## Capture
- `exportTwitchAdLogs()` to download merged script + console timeline.
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
- `[HEALER:RESET_SKIP]` when a non-active hard-reset placeholder is dropped or a reset refresh is cooldown-blocked
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
- `processing_asset_exhausted` now uses the same last-resort path as the manual hook: export logs first, then reload the page.
- Repeated no-source placeholder churn should no longer rescan the same DOM element indefinitely; refresh cooldown now sticks to the element across re-registration.
- Placeholder/no-source suppression now leaves the first few matching logs visible before collapsing the rest into a suppression summary, so loop starts are easier to diagnose.
- Stalls without `HEALER:START` likely indicate the video never became active or a failover lock is active.
- Repeated `FAILOVER_REVERT` means candidates are present but not progressing; check readiness logs.
- Repeated low-rate / high-drift `SYNC` samples can now mark the active stream as degraded even if audio keeps moving; look for `rate` collapsing well below normal before candidate switch decisions.
- A severe post-heal `SYNC` collapse on the only active candidate now triggers forced self-recovery instead of simply waiting for more limping progress.
- After a `NO_HEAL_POINT` path, `BACKOFF` now stays pending until a healthy post-resume `SYNC` sample arrives; if playback resumes badly desynced, look for `CATCH_UP` scheduling before any stronger recovery step.
- Non-active candidates that freeze near the buffer edge should now age into `dead_candidate` instead of lingering indefinitely as pseudo-viable alternates.
- `scan_buffer_starved` should no longer hand control to a paused `progress_stale` alternate during probation; if it still does, inspect the candidate score/trust snapshot because that now indicates stronger identity or fresh progress than the old ad-shaped failure.
- `fast_switch` decisions can still mean a recovered origin stream reclaimed control from an untrusted healing active candidate, but only when the target truly matches the stream origin (`identity_origin_video` or origin-src match).
- `Stream continuity snapshot` logs now show `originVideoId`, `originElementId`, and the active/preferred element ids at switch time; use them to test whether Twitch kept the real stream on the same underlying video while ad-like alternates appeared alongside it.

## Tuning Cheat Sheet
Use this mapping to connect config knobs to the log lines they influence.

- `stall.INIT_PROGRESS_GRACE_MS`: `[HEALER:WATCHDOG] Awaiting initial progress`, `Initial progress timeout`
- `stall.STALL_CONFIRM_MS` / `STALL_CONFIRM_BUFFER_OK_MS`: `[HEALER:WATCHDOG] No progress observed`
- `stall.FAILOVER_*`: `[HEALER:FAILOVER_*]` entries
- `monitoring.CANDIDATE_*`: `[HEALER:CANDIDATE]` switch/suppress logs
- `monitoring.TRUST_STALE_MS`: candidate snapshot `trustReason: progress_stale`
- `monitoring.PROBE_COOLDOWN_MS`: `[HEALER:PROBE_SKIP] Probe cooldown active`
- `monitoring.SYNC_RATE_MIN` / `SYNC_DRIFT_MAX_MS`: `[SYNC] Playback drift sample`
- `monitoring.DEGRADED_ACTIVE_SAMPLE_COUNT`: repeated degraded `SYNC` samples before the active stream is treated as degraded
- `monitoring.SYNC_SEVERE_RATE_MIN` / `SYNC_SEVERE_DRIFT_MS`: immediate severe-sync thresholds used for forced post-heal self-recovery
- `recovery.CATCH_UP_*`: `[HEALER:CATCH_UP]` scheduling/seek logs, including bounded post-no-heal resync
- `stall.PLAY_BACKOFF_CLEAR_PROGRESS_MS`: minimum healthy resumed-progress window before play-error backoff clears
- `logging.ACTIVE_LOG_MS` / `NON_ACTIVE_LOG_MS`: `[HEALER:WATCHDOG] No progress observed`
- `logging.CONSOLE_SIGNAL_THROTTLE_MS`: `[INSTRUMENT:CONSOLE_HINT]` frequency
- `logging.RESOURCE_HINT_THROTTLE_MS`: `[INSTRUMENT:RESOURCE_HINT]` frequency
