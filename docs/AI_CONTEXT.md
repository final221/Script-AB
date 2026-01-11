# AI Context & Navigation Guide

## Project Identity
- **Name**: Twitch Stream Healer
- **Type**: Userscript (Browser Extension)
- **Target**: Twitch.tv
- **Purpose**: Heal stream playback after uBlock Origin blocks ad segments
- **Environment**: Browser (Tampermonkey/Violentmonkey), No Node.js runtime in production.

## Core Constraints
1.  **Monolithic Output**: All modules in `src/` are bundled into a single file `dist/code.js`.
2.  **No External Dependencies**: The final script must be self-contained. No `npm install` dependencies in the output.
3.  **DOM Volatility**: Twitch's DOM changes frequently. Video element selectors are simple (`video`).
4.  **Passive Approach**: Only intervene when playback is definitively stuck. Let the player self-heal when possible.

## Key Directories for AI
- `src/core/`: **Start here**. Contains `CoreOrchestrator.js` (entry point) and `StreamHealer.js` (main logic).
- `src/recovery/`: Buffer analysis (`BufferGapFinder.js`) and seeking (`LiveEdgeSeeker.js`).
- `src/monitoring/`: Logging infrastructure.
- `docs/ARCHITECTURE.md`: **Truth**. Always cross-reference this for module interactions.

## Common Tasks & Files
- **Fixing Heal Logic**: Check `src/core/StreamHealer.js`.
- **Buffer Analysis Issues**: Check `src/recovery/BufferGapFinder.js`.
- **Seek Failures**: Check `src/recovery/LiveEdgeSeeker.js`.
- **Adding Logs**: Use `src/monitoring/Logger.js`.
- **Updating Version**: Run `node build/build.js`.

## "Gotchas"
- **Video.buffered**: This is a `TimeRanges` object, not an array. Must iterate with `.start(i)` and `.end(i)`.
- **Readonly Properties**: `video.buffered`, `video.readyState` are readonly. Tests must use `Object.defineProperty()`.
- **window object**: We run in page context via userscript, full access to DOM and video elements.

## Navigation Map
| Feature | Primary Module | Related Modules |
| :--- | :--- | :--- |
| **Stall Detection** | `StreamHealer` | `BufferGapFinder.isBufferExhausted` |
| **Heal Point Finding** | `BufferGapFinder` | - |
| **Seeking** | `LiveEdgeSeeker` | - |
| **Logging** | `Logger` | `Instrumentation` |

## Debugging Tools
The following global functions are exposed for debugging:
- `window.getTwitchHealerStats()`: Returns current heal statistics.
- `window.exportTwitchAdLogs()`: Downloads merged timeline of script + console logs.

## Module Load Order
Build order matters (dependencies must load first):
1. `Config.js` - Configuration constants
2. `Utils.js` - Utility functions (Fn namespace)
3. `Adapters.js` - DOM adapters
4. `BufferRanges.js` - Buffer range helpers
5. `HealPointFinder.js` - Heal point search
6. `BufferGapFinder.js` - Buffer analysis facade
7. `SeekTargetCalculator.js` - Seek target validation
8. `LiveEdgeSeeker.js` - Seek execution
9. `ErrorClassifier.js` - Error classification
10. `Logger.js` - Logging (used by everything)
11. `Metrics.js` - Metrics tracking
12. `ReportGenerator.js` - Export functionality
13. `ConsoleInterceptor.js` - Console capture hooks
14. `ConsoleSignalDetector.js` - Console signal detection
15. `Instrumentation.js` - Console capture (uses Logger)
16. `VideoState.js` - Shared video state helper
17. `PlaybackStateTracker.js` - Progress/stall tracking helper
18. `PlaybackEventHandlers.js` - Event binding for playback monitoring
19. `PlaybackWatchdog.js` - Watchdog interval logic
20. `PlaybackMonitor.js` - Event-driven stall detection + watchdog
21. `CandidateScorer.js` - Candidate scoring logic
22. `CandidateSelector.js` - Active video scoring/selection
23. `BackoffManager.js` - Heal backoff tracking
24. `FailoverManager.js` - Failover attempt orchestration
25. `RecoveryManager.js` - Backoff + failover coordination
26. `MonitorRegistry.js` - Monitored video lifecycle
27. `HealPointPoller.js` - Heal point polling
28. `HealPipeline.js` - Heal-point polling + seeking
29. `ExternalSignalRouter.js` - Console signal hints
30. `StreamHealer.js` - Main healer (uses all above)
31. `CoreOrchestrator.js` - Entry point (initializes everything)



