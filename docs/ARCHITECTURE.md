# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CoreOrchestrator                       │
│                    (Main Entry Point)                       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
      │ StreamHealer │ │Instrumentation│ │   Logger    │
      └──────────────┘ └─────────────┘ └──────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
┌─────────────┐   ┌─────────────┐
│BufferGapFinder│ │LiveEdgeSeeker│
└─────────────┘   └─────────────┘
```

## Module Dependency Graph

```
CoreOrchestrator
├─> Instrumentation (console capture for debugging)
├─> StreamHealer (main healing orchestrator)
�"o�"?> VideoState (shared video state helper)
│   ├─> PlaybackMonitor (event-driven stall detection)
│   ├─> BufferGapFinder (buffer analysis)
│   │   └─> findHealPoint() - finds buffer ahead of currentTime
│   │   └─> isBufferExhausted() - detects stall condition
│   └─> LiveEdgeSeeker (seek execution)
│       └─> seekAndPlay() - seeks to heal point, resumes playback
│       └─> validateSeekTarget() - ensures target is within buffer
└─> Logger (merged timeline collection)
    └─> ReportGenerator (export functionality)
```

## Module Load Order

The build uses a priority list followed by auto-discovered modules, then the entry module.

<!-- LOAD_ORDER_START -->
1. `config/Config.js`
2. `utils/Utils.js`
3. `utils/Adapters.js`
4. `recovery/BufferGapFinder.js`
5. `recovery/LiveEdgeSeeker.js`
6. `monitoring/ErrorClassifier.js`
7. `monitoring/Logger.js`
8. `monitoring/Metrics.js`
9. `monitoring/ReportGenerator.js`
10. `monitoring/Instrumentation.js`
11. `core/VideoState.js`
12. `core/PlaybackStateTracker.js`
13. `core/PlaybackMonitor.js`
14. `core/CandidateSelector.js`
15. `core/RecoveryManager.js`
16. `core/MonitorRegistry.js`
17. `core/HealPipeline.js`
18. `core/ExternalSignalRouter.js`
19. `core/StreamHealer.js`
20. `core/CoreOrchestrator.js`
<!-- LOAD_ORDER_END -->


## Data Flow

### Stall Detection & Healing
```
Video Element → StreamHealer.monitor()
                      │
                      ▼ (events + watchdog)
                 Check: no progress?
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
       No → Reset counter        Yes → Increment counter
                                       │
                                       ▼ (4 consecutive)
                              StreamHealer.attemptHeal()
                                       │
                                       ▼
                              BufferGapFinder.findHealPoint()
                                       │
                         ┌─────────────┴─────────────┐
                         ▼                           ▼
                    Found? → LiveEdgeSeeker       Not found?
                         │   .seekAndPlay()          │
                         │                           ▼
                         ▼                      Log & wait
                 Seek + Play                    (up to 15s)
                         │
                         ▼
                 Log result ✓ or ✗
```

### Logging Timeline
```
Console.log/warn/error ─────┐
                            │
Script Logger.add() ────────┼──> Logger.getMergedTimeline()
                            │         │
                            ▼         ▼
                      Sorted by timestamp
                            │
                            ▼
                   exportTwitchAdLogs()
                            │
                            ▼
                   📁 stream_healer_logs_*.txt
                   (🔧 Script | 📋 Log | ⚠️ Warn | ❌ Error)
```

## Layer Responsibilities

### Configuration Layer
- **Config.js** - Central configuration, frozen object
  - `stall.WATCHDOG_INTERVAL_MS: 1000` - Watchdog check frequency
  - `stall.STALL_CONFIRM_MS: 2500` - No-progress window before healing
  - `stall.STALL_CONFIRM_BUFFER_OK_MS: 1500` - Extra delay when buffer looks healthy
  - `stall.PAUSED_STALL_GRACE_MS: 3000` - Allow stall detection shortly after pause
  - `stall.RETRY_COOLDOWN_MS: 2000` - Cooldown between heal attempts
  - `stall.HEAL_TIMEOUT_S: 15` - Max wait for heal point
  - `stall.NO_HEAL_POINT_BACKOFF_BASE_MS: 5000` - Base backoff after no heal point
  - `stall.NO_HEAL_POINT_BACKOFF_MAX_MS: 60000` - Max backoff after repeated no heal points
  - `stall.FAILOVER_AFTER_NO_HEAL_POINTS: 3` - Failover after consecutive no-heal points
  - `stall.FAILOVER_AFTER_STALL_MS: 30000` - Failover after long stall without progress
  - `stall.FAILOVER_PROGRESS_TIMEOUT_MS: 8000` - Failover trial window
  - `stall.FAILOVER_COOLDOWN_MS: 30000` - Minimum time between failovers
  - `monitoring.MAX_VIDEO_MONITORS: 3` - Max concurrent video elements to monitor
  - `monitoring.CANDIDATE_SWITCH_DELTA: 2` - Score delta required to switch active video
  - `monitoring.CANDIDATE_MIN_PROGRESS_MS: 5000` - Minimum sustained progress before switching to new video
  - `monitoring.PROGRESS_STREAK_RESET_MS: 2500` - Reset progress streak after this long without progress

### Utility Layer
- **Utils.js (Fn)** - Pure utility functions (pipe, debounce, sleep, tryCatch)
- **Adapters.js** - Side-effect wrappers (DOM operations)

### Core Layer
- **CoreOrchestrator.js** - Application initialization, global function exports
- **VideoState.js** - Shared video state helper
- **PlaybackStateTracker.js** - Progress and stall state tracking
- **PlaybackMonitor.js** - Event-driven playback monitoring with watchdog
- **CandidateSelector.js** - Scores and selects the active video
- **RecoveryManager.js** - Backoff and failover coordination
- **MonitorRegistry.js** - Tracks monitored video lifecycle
- **HealPipeline.js** - Polls for heal points and executes seeks
- **ExternalSignalRouter.js** - Handles console signal hints
- **StreamHealer.js** - Main orchestrator for stall detection and healing

### Recovery Layer
- **BufferGapFinder.js** - Analyzes video buffer for heal points
  - `findHealPoint()` - Finds buffer range starting after currentTime
  - `isBufferExhausted()` - Checks if we're at buffer edge
  - `getBufferRanges()` - Extracts all buffer ranges
- **LiveEdgeSeeker.js** - Executes seek and play operations
  - `seekAndPlay()` - Seeks to heal point, starts playback
  - `validateSeekTarget()` - Ensures seek is safe (within buffer)
  - `calculateSafeTarget()` - Calculates optimal seek position

### Monitoring Layer
- **Logger.js** - Log collection with console capture
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




