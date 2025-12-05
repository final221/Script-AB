# Architecture

## System Overview (v3.0)

```
┌─────────────────────────────────────────────────────────────┐
│                      CoreOrchestrator                       │
│                    (Main Entry Point)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
        ┌──────────┐   ┌───────────┐  ┌──────────┐
        │ Network  │   │   Core    │  │ Monitor  │
        │ Manager  │   │  Layer    │  │   ing    │
        └──────────┘   └───────────┘  └──────────┘
```

## Module Dependency Graph

```
CoreOrchestrator
├─> NetworkManager
│   ├─> AdBlocker (ad detection & event emission)
│   ├─> Diagnostics (network logging, video segment tracking)
│   └─> Mocking (response mocking)
│
├─> EventCoordinator (EventBus setup)
│   └─> ResilienceOrchestrator (on AD_DETECTED)
│
├─> ScriptBlocker (DOM observation for ad scripts)
│
└─> DOMObserver
    └─> PlayerLifecycle
        ├─> VideoListenerManager (video event handling)
        ├─> HealthMonitor
        │   └─> StuckDetector (high tolerance: 0.5s/5 checks)
        └─> PlayerContext (React/Vue scanning)

ResilienceOrchestrator (v3.0 - Simplified)
├─> BufferAnalyzer (buffer health analysis)
├─> RecoveryStrategy (ALWAYS returns StandardRecovery)
│   └─> StandardRecovery (play first, gentle seek fallback)
│   └─> [DISABLED] AggressiveRecovery
│   └─> [DISABLED] ExperimentalRecovery
└─> PlayRetryHandler (play retry logic)
```

## Data Flow

### 1. Network Interception
```
User Request → NetworkManager → AdBlocker
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
            [Trigger?]         [Ad URL?]      [Video Request?]
                  │                 │                 │
                  ▼                 ▼                 ▼
          AD_DETECTED event    Mock Response   Log to Timeline
```

### 2. Event Bus Flow (v3.0)
```
[Instrumentation] ──AD_DETECTED──┐  (30s debounce, checks if recovered)
                                 │
[HealthMonitor]  ──AD_DETECTED──┼──> [EventCoordinator]
                                 │         │
                                 │         ▼
                                 │   [ResilienceOrchestrator]
                                 │         │
                                 ▼         ▼
                          StandardRecovery ONLY
                          (try play → gentle seek)
                          
                    [DISABLED: Aggressive/Experimental/Page Reload]
```

### 3. Logging Timeline (v3.0 NEW)
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
                   📁 twitch_ad_logs_*.txt
                   (🔧 Script | 📋 Log | ⚠️ Warn | ❌ Error)
```

## Layer Responsibilities

### Configuration Layer
- **Config.js** - Central configuration, frozen object
  - `STUCK_THRESHOLD_S: 0.5` (was 0.1)
  - `STUCK_COUNT_LIMIT: 5` (was 2)

### Utility Layer
- **Utils.js (Fn)** - Pure utility functions (compose, debounce, sleep)
- **Adapters.js** - Side-effect wrappers (DOM, Storage, EventBus)
- **Logic.js** - Pure business logic (ad detection, player signatures)

### Network Layer
- **AdBlocker.js** - Ad pattern detection, event emission
- **Diagnostics.js** - Network request logging, video segment tracking
- **Mocking.js** - Mock response generation
- **NetworkManager.js** - XHR/Fetch hooking orchestration

### Player Context Layer
- **PlayerContext.js** - React/Vue player instance scanning
- **VideoListenerManager.js** - Video element event management

### Health Layer
- **StuckDetector.js** - Playback stuck detection (high tolerance)
- **FrameDropDetector.js** - Frame drop monitoring
- **AVSyncDetector.js** - Audio/video sync monitoring
- **HealthMonitor.js** - Health check orchestration

### Recovery Layer (v3.0 - Simplified)
- **BufferAnalyzer.js** - Buffer health analysis
- **PlayRetryHandler.js** - Play retry with exponential backoff
- **StandardRecovery.js** - Gentle recovery (play first, seek fallback)
- **AggressiveRecovery.js** - [DISABLED] Stream refresh recovery
- **ExperimentalRecovery.js** - [DISABLED]
- **RecoveryStrategy.js** - Always returns StandardRecovery
- **ResilienceOrchestrator.js** - Gentle recovery coordinator (no page reload)

### Monitoring Layer (v3.0 - Enhanced)
- **Instrumentation.js** - Console capture, stall detection (30s debounce)
- **Logger.js** - Log collection, console capture, merged timeline
- **Metrics.js** - Metrics tracking
- **ReportGenerator.js** - Report generation with emoji indicators
- **Store.js** - Persistent state via localStorage

### Core Layer
- **ScriptBlocker.js** - Ad script blocking via MutationObserver
- **EventCoordinator.js** - EventBus setup (ACQUIRE, AD_DETECTED)
- **PlayerLifecycle.js** - Player mount/unmount lifecycle
- **DOMObserver.js** - Root DOM observation
- **CoreOrchestrator.js** - Application initialization

## v3.0 Recovery Philosophy

### Before (v2.x)
```
Problem detected → Standard → Experimental → Aggressive → PAGE RELOAD
                    (cascade of increasingly destructive interventions)
```

### After (v3.0)
```
Problem detected → Check if already recovered → Standard (play/seek) → LOG
                    (passive, let player self-heal, comprehensive logging)
```

### Why This Change?
Log analysis showed:
1. Aggressive recovery was **destroying** functional players
2. Page reload was triggered when stream source was already dead
3. Recovery cascade made things worse, not better
4. The player often self-healed if given time

## Log Prefixes (v3.0)

| Prefix | Source | Description |
|--------|--------|-------------|
| `[RECOVERY:*]` | ResilienceOrchestrator | Recovery lifecycle |
| `[STRATEGY:*]` | RecoveryStrategy | Strategy selection |
| `[STANDARD:*]` | StandardRecovery | Recovery steps |
| `[INSTRUMENT:*]` | Instrumentation | Stall/error detection |
| `[NETWORK:*]` | Diagnostics | M3U8/segment requests |

## Error Handling (v3.0)

### Instrumentation Layer
- Captures `console.log`, `console.warn`, `console.error` with timestamps
- 30-second debounce on "playhead stalling" (was 10s)
- Checks if player recovered before triggering recovery
- All console output merged into export timeline

### Recovery Triggers
1. **Stall-based**: Playhead stalling for 30+ seconds → Check if recovered → AD_DETECTED
2. **Health-based**: 5+ consecutive stuck checks → AD_DETECTED
3. **Error-based**: MediaError → LOG (no automatic recovery)

### What's Disabled
- AggressiveRecovery (quality toggle, source reload)
- ExperimentalRecovery
- Page reload fallback
- Automatic escalation

## State Management

### Logger (v3.0)
```javascript
{
    logs: [],           // Script internal logs (max 5000)
    consoleLogs: [],    // Captured console output (max 2000)
}
```

### Metrics
```javascript
{
    ads_detected: number,
    ads_blocked: number,
    resilience_executions: number,
    aggressive_recoveries: number,  // Should always be 0 in v3.0
    health_triggers: number,
    errors: number
}
```

