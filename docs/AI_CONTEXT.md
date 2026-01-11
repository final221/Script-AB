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
4. `BufferGapFinder.js` - Buffer analysis
5. `LiveEdgeSeeker.js` - Seek execution
6. `ErrorClassifier.js` - Error classification
7. `Logger.js` - Logging (used by everything)
8. `Metrics.js` - Metrics tracking
9. `ReportGenerator.js` - Export functionality
10. `Instrumentation.js` - Console capture (uses Logger)
11. `PlaybackMonitor.js` - Event-driven stall detection + watchdog
12. `StreamHealer.js` - Main healer (uses all above)
13. `CoreOrchestrator.js` - Entry point (initializes everything)



