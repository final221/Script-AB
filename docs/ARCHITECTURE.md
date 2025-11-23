# Architecture

## System Overview

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
│   ├─> Diagnostics (network logging)
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
        │   ├─> StuckDetector
        │   ├─> FrameDropDetector
        │   └─> AVSyncDetector
        └─> PlayerContext (React/Vue scanning)

ResilienceOrchestrator
├─> BufferAnalyzer (buffer health analysis)
├─> RecoveryStrategy (strategy selection)
│   ├─> StandardRecovery (seek-based)
│   └─> AggressiveRecovery (stream refresh)
└─> PlayRetryHandler (play retry logic)
```

## Data Flow

### 1. Network Interception
```
User Request → NetworkManager → AdBlocker
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
            [Trigger?]         [Ad URL?]      [Diagnostic Log]
                  │                 │
                  ▼                 ▼
          AD_DETECTED event    Mock Response
```

### 2. Event Bus Flow
```
[NetworkManager] ──AD_DETECTED──┐
                                 │
[HealthMonitor]  ──AD_DETECTED──┼──> [EventCoordinator]
                                 │         │
[PlayerLifecycle] ──ACQUIRE─────┘         ▼
                              [ResilienceOrchestrator]
                                         │
                                         ▼
                              ┌──────────┴──────────┐
                              ▼                     ▼
                     StandardRecovery    AggressiveRecovery
```

### 3. Player Lifecycle
```
DOM Change → DOMObserver → PlayerLifecycle
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   handleMount()         PlayerContext      VideoListenerManager
          │                    │                    │
          ▼                    ▼                    ▼
   ACQUIRE event      Player signature      Error handling
                        scanning              & cleanup
```

## Layer Responsibilities

### Configuration Layer
- **Config.js** - Central configuration, frozen object

### Utility Layer
- **Utils.js (Fn)** - Pure utility functions (compose, debounce, sleep)
- **Adapters.js** - Side-effect wrappers (DOM, Storage, EventBus)
- **Logic.js** - Pure business logic (ad detection, player signatures)

### Network Layer
- **AdBlocker.js** - Ad pattern detection, event emission
- **Diagnostics.js** - Network request logging & sampling
- **Mocking.js** - Mock response generation
- **NetworkManager.js** - XHR/Fetch hooking orchestration

### Player Context Layer
- **PlayerContext.js** - React/Vue player instance scanning
- **VideoListenerManager.js** - Video element event management

### Health Layer
- **StuckDetector.js** - Playback stuck detection
- **FrameDropDetector.js** - Frame drop monitoring
- **AVSyncDetector.js** - Audio/video sync monitoring
- **HealthMonitor.js** - Health check orchestration

### Recovery Layer
- **BufferAnalyzer.js** - Buffer health analysis
- **PlayRetryHandler.js** - Play retry with exponential backoff
- **StandardRecovery.js** - Seek-based recovery
- **AggressiveRecovery.js** - Stream refresh recovery
- **RecoveryStrategy.js** - Strategy selector
- **ResilienceOrchestrator.js** - Recovery coordinator

### Monitoring Layer
- **Instrumentation.js** - Global error & console interception
- **Logger.js** - Log collection & export
- **Metrics.js** - Metrics tracking
- **ReportGenerator.js** - Report generation
- **Store.js** - Persistent state via localStorage

### Core Layer
- **ScriptBlocker.js** - Ad script blocking via MutationObserver
- **EventCoordinator.js** - EventBus setup (ACQUIRE, AD_DETECTED)
- **PlayerLifecycle.js** - Player mount/unmount lifecycle
- **DOMObserver.js** - Root DOM observation
- **CoreOrchestrator.js** - Application initialization

## Design Patterns

### Strategy Pattern (Recovery)
```javascript
RecoveryStrategy.select(video) 
  → StandardRecovery or AggressiveRecovery
```

### Orchestrator Pattern
- `CoreOrchestrator` - App initialization
- `NetworkManager` - Network operations
- `HealthMonitor` - Health checks
- `ResilienceOrchestrator` - Recovery execution

### Observer Pattern
- EventBus (custom implementation in Adapters)
- MutationObserver (ScriptBlocker, DOMObserver, PlayerLifecycle)

### Facade Pattern
- Adapters (DOM, Storage, EventBus abstractions)

## Communication

### EventBus Events
- **AD_DETECTED** - Triggered by network layer or health monitor
- **ACQUIRE** - Triggered to acquire player context
- **REPORT** - Triggered after recovery completion
- **LOG** - Triggered for log export

### Module Interfaces
All modules expose a minimal public API:
```javascript
const Module = (() => {
    // Private state & functions
    
    return {
        // Public API
        init: () => { },
        method: () => { }
    };
})();
```

## Error Handling

### Instrumentation Layer
- Intercepts global errors (`window.addEventListener('error')`)
- Intercepts console.error / console.warn
- Classifies errors by type (MediaError, TypeError, etc.)
- Assigns severity levels (CRITICAL, MEDIUM, LOW)

### Recovery Triggers
1. **Network-based**: Ad URL detected → AD_DETECTED
2. **Health-based**: Stuck playback → AD_DETECTED
3. **Error-based**: MediaError code 4 → Recovery (via Instrumentation)

## State Management

### Store (localStorage)
```javascript
{
    lastAttempt: timestamp,
    errorCount: number,
    logs: array
}
```

### PlayerContext Cache
- WeakSet for visited nodes
- Cached player reference
- Cache invalidation on player unmount
