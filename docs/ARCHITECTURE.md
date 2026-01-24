# Architecture

## System Overview

```
+-------------------+
| CoreOrchestrator  |
| (entry point)     |
+-------------------+
        |\
        | +-> Instrumentation
        | +-> Logger
        |        |
        |        +-> ReportGenerator
        +-> StreamHealer
                |
                +-> BufferGapFinder
                +-> LiveEdgeSeeker
```

## Module Dependency Graph

```
CoreOrchestrator
  -> Instrumentation (console capture for debugging)
  -> StreamHealer (main healing orchestrator)
  -> VideoState (shared video state helper)
       -> PlaybackMonitor (event-driven stall detection)
       -> BufferGapFinder (buffer analysis)
            -> findHealPoint() - finds buffer ahead of currentTime
            -> isBufferExhausted() - detects stall condition
       -> LiveEdgeSeeker (seek execution)
            -> seekAndPlay() - seeks to heal point, resumes playback
            -> validateSeekTarget() - ensures target is within buffer
  -> Logger (merged timeline collection)
       -> ReportGenerator (export functionality)
```

## Module Load Order

The build uses a priority list followed by auto-discovered modules, then the entry module.

<!-- LOAD_ORDER_START -->
1. `config/Config.js`
2. `config/BuildInfo.js`
3. `config/Tuning.js`
4. `config/Validate.js`
5. `utils/Utils.js`
6. `utils/Adapters.js`
7. `recovery/BufferRanges.js`
8. `recovery/HealPointFinder.js`
9. `recovery/BufferGapFinder.js`
10. `recovery/SeekTargetCalculator.js`
11. `recovery/LiveEdgeSeeker.js`
12. `monitoring/ErrorClassifier.js`
13. `monitoring/LogTagRegistry.js`
14. `monitoring/LogSchemas.js`
15. `monitoring/LogSanitizer.js`
16. `monitoring/LogNormalizer.js`
17. `monitoring/Logger.js`
18. `monitoring/LogEvents.js`
19. `monitoring/TagCategorizer.js`
20. `monitoring/DetailFormatter.js`
21. `monitoring/LogFormatter.js`
22. `monitoring/LegendRenderer.js`
23. `monitoring/ReportTemplate.js`
24. `monitoring/ResourceWindow.js`
25. `monitoring/Metrics.js`
26. `monitoring/TimelineRenderer.js`
27. `monitoring/ReportGenerator.js`
28. `monitoring/ConsoleInterceptor.js`
29. `monitoring/ConsoleSignalDetector.js`
30. `monitoring/Instrumentation.js`
31. `core/VideoState.js`
32. `core/VideoStateSnapshot.js`
33. `core/StateSnapshot.js`
34. `core/PlaybackLogHelper.js`
35. `core/MediaState.js`
36. `core/PlaybackStateStore.js`
37. `core/PlaybackResetLogic.js`
38. `core/PlaybackProgressLogic.js`
39. `core/PlaybackSyncLogic.js`
40. `core/PlaybackStarvationLogic.js`
41. `core/RecoveryContext.js`
42. `core/PlaybackStateTracker.js`
43. `core/PlaybackEventLogger.js`
44. `core/PlaybackEventHandlersProgress.js`
45. `core/PlaybackEventHandlersReady.js`
46. `core/PlaybackEventHandlersStall.js`
47. `core/PlaybackEventHandlersLifecycle.js`
48. `core/PlaybackEventHandlers.js`
49. `core/PlaybackWatchdog.js`
50. `core/PlaybackMonitor.js`
51. `core/CandidateScorer.js`
52. `core/CandidateSwitchPolicy.js`
53. `core/CandidateTrust.js`
54. `core/CandidateScoreRecord.js`
55. `core/CandidateSelector.js`
56. `core/BackoffManager.js`
57. `core/ProbationPolicy.js`
58. `core/NoHealPointPolicy.js`
59. `core/PlayErrorPolicy.js`
60. `core/StallSkipPolicy.js`
61. `core/RecoveryPolicyFactory.js`
62. `core/RecoveryPolicy.js`
63. `core/FailoverCandidatePicker.js`
64. `core/FailoverManager.js`
65. `core/RecoveryManager.js`
66. `core/MonitorRegistry.js`
67. `core/MonitorCoordinator.js`
68. `core/HealPointPoller.js`
69. `core/HealPipeline.js`
70. `core/AdGapSignals.js`
71. `core/PlayheadAttribution.js`
72. `core/VideoDiscovery.js`
73. `core/ExternalSignalRouter.js`
74. `core/MonitoringOrchestrator.js`
75. `core/RecoveryOrchestrator.js`
76. `core/StreamHealer.js`
77. `core/CoreOrchestrator.js`
<!-- LOAD_ORDER_END -->


## Data Flow

### Stall Detection & Healing
```
Video element -> StreamHealer.monitor()
  - event handlers + watchdog
  - check progress
    - no progress: reset counter
    - stall: increment counter
  - after threshold: StreamHealer.attemptHeal()
    - BufferGapFinder.findHealPoint()
      - found: LiveEdgeSeeker.seekAndPlay()
      - not found: log + wait (up to 15s)
  - log result
```

### Logging Timeline
```
Console.log/warn/error -> Instrumentation -> Logger.add()
Script Logger.add() -> Logger.getMergedTimeline()
  -> sort by timestamp -> exportTwitchAdLogs()
  -> writes stream_healer_logs_*.txt
     (Script | Console | Warn | Error)
```

## Layer Responsibilities

### Configuration Layer
- **Config.js** - Central configuration, frozen object
  - `stall.WATCHDOG_INTERVAL_MS: 1000` - Watchdog check frequency
  - `stall.STALL_CONFIRM_MS: 2500` - No-progress window before healing
  - `stall.STALL_CONFIRM_BUFFER_OK_MS: 1500` - Extra delay when buffer looks healthy
  - `stall.PAUSED_STALL_GRACE_MS: 3000` - Allow stall detection shortly after pause
  - `stall.INIT_PROGRESS_GRACE_MS: 5000` - Wait for initial progress before treating as stalled
  - `stall.RETRY_COOLDOWN_MS: 2000` - Cooldown between heal attempts
  - `stall.HEAL_TIMEOUT_S: 15` - Max wait for heal point
  - `stall.NO_HEAL_POINT_BACKOFF_BASE_MS: 5000` - Base backoff after no heal point
  - `stall.NO_HEAL_POINT_BACKOFF_MAX_MS: 60000` - Max backoff after repeated no heal points
  - `stall.FAILOVER_AFTER_NO_HEAL_POINTS: 3` - Failover after consecutive no-heal points
  - `stall.FAILOVER_AFTER_STALL_MS: 30000` - Failover after long stall without progress
  - `stall.FAILOVER_PROGRESS_TIMEOUT_MS: 8000` - Failover trial window
  - `stall.FAILOVER_COOLDOWN_MS: 30000` - Minimum time between failovers
  - `monitoring.MAX_VIDEO_MONITORS: 8` - Max concurrent video elements to monitor
  - `monitoring.CANDIDATE_SWITCH_DELTA: 2` - Score delta required to switch active video
  - `monitoring.CANDIDATE_MIN_PROGRESS_MS: 5000` - Minimum sustained progress before switching to new video
  - `monitoring.PROGRESS_STREAK_RESET_MS: 2500` - Reset progress streak after this long without progress
  - `monitoring.PROGRESS_RECENT_MS: 2000` - "Recent progress" scoring threshold
  - `monitoring.PROGRESS_STALE_MS: 5000` - "Stale progress" scoring threshold
  - `monitoring.TRUST_STALE_MS: 8000` - Trust expires if progress is older than this
  - `monitoring.PROBE_COOLDOWN_MS: 5000` - Min time between probe attempts per candidate
  - `recovery.MIN_HEAL_BUFFER_S: 2` - Minimum buffered seconds needed to heal
  - `recovery.SEEK_SETTLE_MS: 100` - Wait after seek before validation
  - `recovery.PLAYBACK_VERIFY_MS: 200` - Wait after play to verify playback
  - `logging.ACTIVE_LOG_MS: 5000` - Active candidate log interval
  - `logging.NON_ACTIVE_LOG_MS: 300000` - Non-active candidate log interval
  - `logging.BACKOFF_LOG_INTERVAL_MS: 5000` - Backoff skip log interval
  - `logging.CONSOLE_SIGNAL_THROTTLE_MS: 2000` - Throttle console hint signals
  - `logging.RESOURCE_HINT_THROTTLE_MS: 2000` - Throttle resource hint signals
  - `logging.LOG_MESSAGE_MAX_LEN: 300` - Max length for log messages
  - `logging.LOG_REASON_MAX_LEN: 200` - Max length for error reasons
  - `logging.LOG_URL_MAX_LEN: 200` - Max length for logged URLs
  - `logging.CONSOLE_CAPTURE_MAX_LEN: 500` - Max length for captured console lines
  - `logging.MAX_LOGS: 5000` - Max in-memory script logs
  - `logging.MAX_CONSOLE_LOGS: 2000` - Max in-memory console logs

### Utility Layer
- **Utils.js (Fn)** - Pure utility functions (pipe, debounce, sleep, tryCatch)
- **Adapters.js** - Side-effect wrappers (DOM operations)

### Core Layer
- **CoreOrchestrator.js** - Application initialization, global function exports
- **VideoState.js** - Shared video state helper
- **VideoStateSnapshot.js** - Standardized video state snapshots for logs
- **PlaybackStateTracker.js** - Progress and stall state tracking
- **PlaybackStateStore.js** - Playback state construction and alias mapping
- **PlaybackResetLogic.js** - Reset evaluation and pending reset handling
- **PlaybackProgressLogic.js** - Progress/ready/stall tracking helpers
- **PlaybackSyncLogic.js** - Playback drift sampling
- **PlaybackStarvationLogic.js** - Buffer starvation tracking
- **PlaybackEventLogger.js** - Event log aggregation + summary logic
- **PlaybackEventHandlersProgress.js** - Progress/timeupdate handling
- **PlaybackEventHandlersReady.js** - Ready/playing handlers
- **PlaybackEventHandlersStall.js** - Waiting/stall/pause handlers
- **PlaybackEventHandlersLifecycle.js** - Abort/emptied/error/ended handlers
- **PlaybackEventHandlers.js** - Video event wiring for playback monitoring
- **PlaybackWatchdog.js** - Watchdog interval for stall checks
- **PlaybackMonitor.js** - Event-driven playback monitoring with watchdog
- **CandidateScorer.js** - Scores video candidates
- **CandidateSwitchPolicy.js** - Switch decision logic
- **CandidateScoreRecord.js** - Standardized candidate score records
- **CandidateSelector.js** - Scores and selects the active video
- **BackoffManager.js** - No-heal-point backoff tracking
- **FailoverCandidatePicker.js** - Failover candidate selection
- **FailoverManager.js** - Failover attempt logic
- **RecoveryManager.js** - Backoff and failover coordination
- **MonitorRegistry.js** - Tracks monitored video lifecycle
- **HealPointPoller.js** - Polls for heal points
- **HealPipeline.js** - Polls for heal points and executes seeks
- **ExternalSignalRouter.js** - Handles console signal hints
- **StreamHealer.js** - Main orchestrator for stall detection and healing

### Recovery Layer
- **BufferRanges.js** - Buffer range helpers
  - `getBufferRanges()` - Extracts all buffer ranges
  - `formatRanges()` - Formats ranges for logs
  - `isBufferExhausted()` - Checks if we're at buffer edge
- **HealPointFinder.js** - Finds heal points
  - `findHealPoint()` - Finds buffer range starting after currentTime
- **BufferGapFinder.js** - Buffer analysis facade
- **SeekTargetCalculator.js** - Validates and calculates seek targets
  - `validateSeekTarget()` - Ensures seek is safe (within buffer)
  - `calculateSafeTarget()` - Calculates optimal seek position
- **LiveEdgeSeeker.js** - Executes seek and play operations
  - `seekAndPlay()` - Seeks to heal point, starts playback

### Monitoring Layer
- **Logger.js** - Log collection with console capture
- **LogTagRegistry.js** - Tag metadata (icons, groups, schemas)
- **LogSanitizer.js** - Detail sanitization + ordering
- **LogNormalizer.js** - Normalizes log messages and console captures
- **DetailFormatter.js** - Column-aligned log formatting helpers
- **LogFormatter.js** - Timeline formatting for reports
- **LegendRenderer.js** - Legend generation for report exports
- **TimelineRenderer.js** - Timeline generation for report exports
- **ConsoleInterceptor.js** - Wraps console methods for capture
- **ConsoleSignalDetector.js** - Detects console signal hints
- **Instrumentation.js** - Console interception for timeline
- **Metrics.js** - Metrics tracking (stalls, heals, errors)
- **ReportGenerator.js** - Export functionality
- **ErrorClassifier.js** - Classifies errors by severity

## Log Prefixes

| Prefix | Source | Description |
|--------|--------|-------------|
| `[CORE:*]` | CoreOrchestrator | Initialization, video detection |
| `[HEALER:*]` | StreamHealer | Heal lifecycle |
| `[HEALER:SCAN]` | BufferGapFinder | Buffer scanning |
| `[HEALER:SEEK]` | LiveEdgeSeeker | Seek operations |
| `[INSTRUMENT:*]` | Instrumentation | Error/console capture |

## State Management

### StreamHealer
```javascript
{
    isHealing: boolean,      // Currently in heal attempt
    healAttempts: number,    // Total heal attempts
    monitoredCount: number,  // Active monitored videos
}
```

### Logger
```javascript
{
    logs: [],           // Script internal logs (max 5000)
    consoleLogs: [],    // Captured console output (max 2000)
}
```

### Metrics
```javascript
{
    stalls_detected: number,
    heals_successful: number,
    heals_failed: number,
    errors: number,
    session_start: timestamp
}
```

## Healing Philosophy

### Problem
When uBlock Origin blocks ad segments, the video buffer has a gap:
```
[===buffered===][   GAP   ][===new content===]
          ^currentTime stuck here
```

### Solution
1. Detect when currentTime stops progressing
2. Find buffer range starting AFTER currentTime (heal point)
3. Seek to that range and resume playback
```
[===buffered===][   GAP   ][===new content===]
                                  ^seek here
```

### Timing
- Watchdog checks every 1000ms
- Stall confirmed after 2500ms without progress (longer if buffer is healthy)
- Poll for heal point up to 15 seconds
- Cooldown between heal attempts is 2000ms when progress resumed









