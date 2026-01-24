# Tuning Guide

This document lists the main configuration knobs that affect stall detection, healing, and logging.
All settings live in `src/config/Config.js`.

## Stall Detection
- `stall.WATCHDOG_INTERVAL_MS`: How often the watchdog checks for stalls.
- `stall.STALL_CONFIRM_MS`: No-progress window before a stall is confirmed.
- `stall.STALL_CONFIRM_BUFFER_OK_MS`: Extra delay when buffer still looks healthy.
- `stall.PAUSED_STALL_GRACE_MS`: Grace window after pause before treating as stalled.
- `stall.INIT_PROGRESS_GRACE_MS`: Initial grace window before stall detection starts.
- `stall.SELF_RECOVER_GRACE_MS`: Grace window to allow self-recovery signals before healing.
- `stall.SELF_RECOVER_MAX_MS`: Optional max window for self-recovery skips.
- `stall.SELF_RECOVER_EXTRA_MS`: Extra grace when buffer grows or readyState improves.

## Healing + Backoff
- `stall.HEAL_TIMEOUT_S`: Max time to search for a heal point.
- `stall.HEAL_POLL_INTERVAL_MS`: Poll interval while searching for heal points.
- `recovery.MIN_HEAL_HEADROOM_S`: Minimum headroom required to use a heal point.
- `recovery.GAP_OVERRIDE_MIN_GAP_S`: Minimum gap size to allow low-headroom override.
- `recovery.GAP_OVERRIDE_MIN_HEADROOM_S`: Minimum headroom allowed when override triggers.
- `stall.NO_HEAL_POINT_BACKOFF_BASE_MS`: Base backoff after a missing heal point.
- `stall.NO_HEAL_POINT_BACKOFF_MAX_MS`: Max backoff after repeated misses.
- `stall.NO_HEAL_POINT_REFRESH_DELAY_MS`: Delay refresh when headroom is low but src/readyState look valid.
- `stall.NO_HEAL_POINT_REFRESH_MIN_READY_STATE`: Minimum readyState required to allow refresh delay.
- `stall.NO_HEAL_POINT_EMERGENCY_AFTER`: Emergency switch after this many no-heal points.
- `stall.NO_HEAL_POINT_EMERGENCY_COOLDOWN_MS`: Cooldown between emergency switches.
- `stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE`: Minimum readyState for emergency switch candidates.
- `stall.NO_HEAL_POINT_EMERGENCY_REQUIRE_SRC`: Require src for emergency switch candidates.
- `stall.RETRY_COOLDOWN_MS`: Cooldown between heal attempts on the same video.
- `stall.PLAY_ABORT_BACKOFF_BASE_MS`: Base backoff after AbortError failures.
- `stall.PLAY_ABORT_BACKOFF_MAX_MS`: Max backoff after repeated AbortError failures.

## Failover
- `stall.FAILOVER_AFTER_NO_HEAL_POINTS`: Failover after repeated no-heal results.
- `stall.FAILOVER_AFTER_STALL_MS`: Failover after this many stalled ms.
- `stall.FAILOVER_PROGRESS_TIMEOUT_MS`: Trial window for failover candidates.
- `stall.FAILOVER_COOLDOWN_MS`: Minimum time between failover attempts.
- `stall.PROBATION_AFTER_NO_HEAL_POINTS`: Probation threshold for rescans.
- `stall.PROBATION_AFTER_PLAY_ERRORS`: Probation threshold for play errors.
- `stall.PROBATION_RESCAN_COOLDOWN_MS`: Minimum time between probation rescans.

## Candidate Selection
- `monitoring.CANDIDATE_SWITCH_DELTA`: Score delta required to switch active video.
- `monitoring.CANDIDATE_MIN_PROGRESS_MS`: Sustained progress needed before switching.
- `monitoring.PROGRESS_RECENT_MS`: Recent progress threshold used in scoring.
- `monitoring.PROGRESS_STALE_MS`: Stale progress threshold used in scoring.
- `monitoring.TRUST_STALE_MS`: How quickly trust decays for idle candidates.
- `monitoring.PROBE_COOLDOWN_MS`: Minimum time between candidate probes.
- `monitoring.DEAD_CANDIDATE_AFTER_MS`: Mark candidate dead after sustained empty src + readyState 0.
- `monitoring.DEAD_CANDIDATE_COOLDOWN_MS`: Exclude dead candidates for this long.

## Logging + Instrumentation
- `logging.ACTIVE_LOG_MS`: Log interval for active candidates.
- `logging.NON_ACTIVE_LOG_MS`: Log interval for non-active candidates.
- `logging.BACKOFF_LOG_INTERVAL_MS`: Log interval for backoff skip logs.
- `logging.HEAL_DEFER_LOG_MS`: Log interval for low-headroom defers.
- `logging.RESOURCE_WINDOW_PAST_MS`: How far back to capture resource requests on stall.
- `logging.RESOURCE_WINDOW_FUTURE_MS`: How far forward to capture after a stall.
- `logging.RESOURCE_WINDOW_MAX`: Max retained resource events for window logging.

## Suggested Workflow
1. Start with default settings and gather logs during normal playback.
2. Tune one group at a time (stall detection, then healing, then failover).
3. Prefer smaller changes (10-20%) to avoid over-correcting.
4. When adjusting logging, keep enough detail to correlate stalls with buffer ranges.

## Notes
- If you adjust timeouts, keep `STALL_CONFIRM_MS` below `HEAL_TIMEOUT_S * 1000` so healing is still reachable.
- If you increase backoff values, consider also increasing `FAILOVER_AFTER_STALL_MS` to keep the system responsive.
