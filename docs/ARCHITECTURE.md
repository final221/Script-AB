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
13. `monitoring/LogTags.js`
14. `monitoring/LogTagRegistry.js`
15. `monitoring/LogSchemas.js`
16. `monitoring/LogSanitizer.js`
17. `monitoring/LogNormalizer.js`
18. `monitoring/Logger.js`
19. `monitoring/LogEvents.js`
20. `monitoring/TagCategorizer.js`
21. `monitoring/DetailFormatter.js`
22. `monitoring/LogFormatter.js`
23. `monitoring/LegendRenderer.js`
24. `monitoring/ReportTemplate.js`
25. `monitoring/ResourceWindow.js`
26. `monitoring/Metrics.js`
27. `monitoring/TimelineRenderer.js`
28. `monitoring/ReportGenerator.js`
29. `monitoring/ConsoleInterceptor.js`
30. `monitoring/ConsoleSignalDetector.js`
31. `monitoring/Instrumentation.js`
32. `monitoring/LogDebug.js`
33. `core/video/VideoState.js`
34. `core/video/VideoStateSnapshot.js`
35. `core/video/StateSnapshot.js`
36. `core/video/MonitorRegistry.js`
37. `core/video/MonitorCoordinator.js`
38. `core/video/VideoDiscovery.js`
39. `core/video/LogContext.js`
40. `core/playback/PlaybackLogHelper.js`
41. `core/playback/PlaybackStateDefaults.js`
42. `core/playback/PlaybackMediaWatcher.js`
43. `core/playback/MediaState.js`
44. `core/playback/PlaybackStateStore.js`
45. `core/playback/PlaybackResetLogic.js`
46. `core/playback/PlaybackProgressReset.js`
47. `core/playback/PlaybackProgressLogic.js`
48. `core/playback/PlaybackSyncLogic.js`
49. `core/playback/PlaybackStarvationLogic.js`
50. `core/playback/PlaybackStateTracker.js`
51. `core/playback/PlaybackEventLogger.js`
52. `core/playback/PlaybackEventHandlersProgress.js`
53. `core/playback/PlaybackEventHandlersReady.js`
54. `core/playback/PlaybackEventHandlersStall.js`
55. `core/playback/PlaybackEventHandlersLifecycle.js`
56. `core/playback/PlaybackEventHandlers.js`
57. `core/playback/PlaybackWatchdog.js`
58. `core/playback/PlaybackMonitor.js`
59. `core/candidate/CandidateScorer.js`
60. `core/candidate/CandidateSwitchPolicy.js`
61. `core/candidate/CandidateTrust.js`
62. `core/candidate/CandidateScoreRecord.js`
63. `core/candidate/CandidateProbation.js`
64. `core/candidate/CandidateEvaluation.js`
65. `core/candidate/CandidateSelectionLogger.js`
66. `core/candidate/CandidateSelector.js`
67. `core/recovery/RecoveryContext.js`
68. `core/recovery/BackoffManager.js`
69. `core/recovery/ProbationPolicy.js`
70. `core/recovery/NoHealPointPolicy.js`
71. `core/recovery/PlayErrorPolicy.js`
72. `core/recovery/StallSkipPolicy.js`
73. `core/recovery/RecoveryPolicyFactory.js`
74. `core/recovery/RecoveryPolicy.js`
75. `core/recovery/FailoverCandidatePicker.js`
76. `core/recovery/FailoverProbeController.js`
77. `core/recovery/FailoverManager.js`
78. `core/recovery/RecoveryManager.js`
79. `core/recovery/CatchUpController.js`
80. `core/recovery/HealAttemptUtils.js`
81. `core/recovery/HealAttemptLogger.js`
82. `core/recovery/HealPointPoller.js`
83. `core/recovery/HealPipeline.js`
84. `core/recovery/AdGapSignals.js`
85. `core/recovery/PlayheadAttribution.js`
86. `core/recovery/StallHandler.js`
87. `core/external/ExternalSignalUtils.js`
88. `core/external/ExternalSignalHandlerStall.js`
89. `core/external/ExternalSignalHandlerAsset.js`
90. `core/external/ExternalSignalHandlerAdblock.js`
91. `core/external/ExternalSignalHandlerFallback.js`
92. `core/external/ExternalSignalRouter.js`
93. `core/orchestrators/MonitoringOrchestrator.js`
94. `core/orchestrators/RecoveryOrchestrator.js`
95. `core/orchestrators/StreamHealer.js`
96. `core/orchestrators/CoreOrchestrator.js`
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
  - See `docs/CONFIG.md` for generated defaults.
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

### Core Layer (src/core)

#### Orchestrators (src/core/orchestrators)
- **CoreOrchestrator.js** - Application initialization, global function exports
- **StreamHealer.js** - Main orchestrator for stall detection and healing
- **MonitoringOrchestrator.js** - Monitoring + candidate + recovery wiring
- **RecoveryOrchestrator.js** - Stall handling, healing, external signal routing

#### Video lifecycle (src/core/video)
- **VideoDiscovery.js** - Finds playable video elements
- **VideoState.js** - Shared video state helper
- **VideoStateSnapshot.js** - Standardized video state snapshots for logs
- **StateSnapshot.js** - Full/lite snapshot helpers
- **MonitorRegistry.js** - Tracks monitored video lifecycle
- **MonitorCoordinator.js** - Coordinates registry + candidate selection

#### Playback monitoring (src/core/playback)
- **PlaybackStateTracker.js** - Progress and stall state tracking
- **PlaybackStateDefaults.js** - Playback state defaults + alias map
- **PlaybackStateStore.js** - Playback state construction and alias mapping
- **PlaybackResetLogic.js** - Reset evaluation and pending reset handling
- **PlaybackProgressReset.js** - Backoff/flag clearing on progress
- **PlaybackProgressLogic.js** - Progress/ready/stall tracking helpers
- **PlaybackSyncLogic.js** - Playback drift sampling
- **PlaybackStarvationLogic.js** - Buffer starvation tracking
- **PlaybackEventLogger.js** - Event log aggregation + summary logic
- **PlaybackEventHandlersProgress.js** - Progress/timeupdate handling
- **PlaybackEventHandlersReady.js** - Ready/playing handlers
- **PlaybackEventHandlersStall.js** - Waiting/stall/pause handlers
- **PlaybackEventHandlersLifecycle.js** - Abort/emptied/error/ended handlers
- **PlaybackEventHandlers.js** - Video event wiring for playback monitoring
- **PlaybackMediaWatcher.js** - Media element change tracker for watchdog logs
- **PlaybackWatchdog.js** - Watchdog interval for stall checks
- **PlaybackMonitor.js** - Event-driven playback monitoring with watchdog
- **PlaybackLogHelper.js** - Shared log snapshot helpers
- **MediaState.js** - Media state helpers for logs and decisions

#### Candidate selection (src/core/candidate)
- **CandidateScorer.js** - Scores video candidates
- **CandidateSwitchPolicy.js** - Switch decision logic
- **CandidateTrust.js** - Trust window tracking
- **CandidateScoreRecord.js** - Standardized candidate score records
- **CandidateProbation.js** - Probation window tracking
- **CandidateEvaluation.js** - Candidate scoring aggregation
- **CandidateSelectionLogger.js** - Candidate selection log summaries
- **CandidateSelector.js** - Scores and selects the active video

#### Recovery (src/core/recovery)
- **RecoveryContext.js** - Recovery context snapshots and helpers
- **BackoffManager.js** - No-heal-point backoff tracking
- **ProbationPolicy.js** - Probation window policy
- **NoHealPointPolicy.js** - No-heal-point handling rules
- **PlayErrorPolicy.js** - Play error handling rules
- **StallSkipPolicy.js** - Stall skip rules for non-active videos
- **RecoveryPolicyFactory.js** - Policy composition
- **RecoveryPolicy.js** - Policy interface
- **FailoverCandidatePicker.js** - Failover candidate selection
- **FailoverProbeController.js** - Probe attempt tracking for failover
- **FailoverManager.js** - Failover attempt logic
- **RecoveryManager.js** - Backoff and failover coordination
- **CatchUpController.js** - Post-heal live-edge catch-up scheduler
- **HealAttemptUtils.js** - Heal attempt helper utilities
- **HealAttemptLogger.js** - Heal attempt logging helpers
- **HealPointPoller.js** - Polls for heal points
- **HealPipeline.js** - Polls for heal points and executes seeks
- **AdGapSignals.js** - Ad gap signature detection
- **PlayheadAttribution.js** - Playhead attribution helpers

#### External signals (src/core/external)
- **ExternalSignalRouter.js** - Handles console signal hints
- **ExternalSignalUtils.js** - Shared helpers for console signal handling
- **ExternalSignalHandlerStall.js** - Playhead stall signal logic
- **ExternalSignalHandlerAsset.js** - Processing/offline asset signal logic
- **ExternalSignalHandlerAdblock.js** - Ad-block signal logic
- **ExternalSignalHandlerFallback.js** - Default external signal logging

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
- **LogTags.js** - Canonical log tag strings (see `docs/LOG_TAGS.md`)
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









