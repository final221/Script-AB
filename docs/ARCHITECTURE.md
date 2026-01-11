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
│   ├─> BufferGapFinder (buffer analysis)
│   │   └─> findHealPoint() - finds buffer ahead of currentTime
│   │   └─> isBufferExhausted() - detects stall condition
│   └─> LiveEdgeSeeker (seek execution)
│       └─> seekAndPlay() - seeks to heal point, resumes playback
│       └─> validateSeekTarget() - ensures target is within buffer
└─> Logger (merged timeline collection)
    └─> ReportGenerator (export functionality)
```

## Data Flow

### Stall Detection & Healing
```
Video Element → StreamHealer.monitor()
                      │
                      ▼ (every 500ms)
                 Check: is stuck?
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
  - `stall.RETRY_COOLDOWN_MS: 2000` - Cooldown between heal attempts
  - `stall.HEAL_TIMEOUT_S: 15` - Max wait for heal point

### Utility Layer
- **Utils.js (Fn)** - Pure utility functions (pipe, debounce, sleep, tryCatch)
- **Adapters.js** - Side-effect wrappers (DOM operations)

### Core Layer
- **CoreOrchestrator.js** - Application initialization, global function exports
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
    lastStallTime: number,   // Last stall timestamp (debounce)
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
- Check every 500ms
- 4 consecutive stuck = 2 seconds minimum stuck time
- Poll for heal point up to 15 seconds
- 5 second debounce between heal attempts
