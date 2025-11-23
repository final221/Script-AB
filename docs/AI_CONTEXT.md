# AI Context & Navigation Guide

## Project Identity
- **Name**: Mega Ad Dodger 3000
- **Type**: Userscript (Browser Extension)
- **Target**: Twitch.tv
- **Environment**: Browser (Tampermonkey/Violentmonkey), No Node.js runtime in production.

## Core Constraints
1.  **Monolithic Output**: All modules in `src/` are bundled into a single file `dist/code.js`.
2.  **No External Dependencies**: The final script must be self-contained. No `npm install` dependencies in the output.
3.  **DOM Volatility**: Twitch's DOM changes frequently. Selectors must be robust or easily updatable.
4.  **Asynchronous Nature**: Heavy reliance on `MutationObserver` and `setInterval` to handle dynamic content.

## Key Directories for AI
- `src/core/`: **Start here**. Contains `CoreOrchestrator.js` (entry point) and `EventCoordinator.js`.
- `src/network/`: Critical for ad detection logic (`AdBlocker.js`, `NetworkManager.js`).
- `src/recovery/`: Logic for fixing the stream when it breaks (`ResilienceOrchestrator.js`).
- `docs/ARCHITECTURE.md`: **Truth**. Always cross-reference this for module interactions.

## Common Tasks & Files
- **Fixing Ad Detection**: Check `src/network/AdBlocker.js`.
- **Fixing Playback Issues**: Check `src/health/` and `src/recovery/`.
- **Adding Logs**: Use `src/monitoring/Logger.js`.
- **Updating Version**: Run `node build/build.js`.

## "Gotchas"
- **`PlayerContext`**: This module tries to find the internal React/Vue instance of the video player. It's fragile.
- **`window` object**: We are running in the page context (mostly), but be careful with userscript sandboxing.
- **Circular Dependencies**: The `CoreOrchestrator` initializes everything, but modules communicate via `EventCoordinator` to avoid tight coupling.

## Navigation Map
| Feature | Primary Module | Related Modules |
| :--- | :--- | :--- |
| **Ad Blocking** | `NetworkManager` | `AdBlocker`, `ScriptBlocker` |
| **Stream Recovery** | `ResilienceOrchestrator` | `StandardRecovery`, `AggressiveRecovery` |
| **Monitoring** | `HealthMonitor` | `StuckDetector`, `FrameDropDetector` |
| **Logging** | `Logger` | `Diagnostics`, `Instrumentation` |

## Debugging Tools
The following global functions are exposed for debugging and manual intervention:
- `window.forceTwitchAdRecovery()`: Triggers the standard `AD_DETECTED` event flow.
- `window.forceTwitchAggressiveRecovery()`: Forces an **Aggressive Recovery** (stream reload), bypassing buffer health checks. Useful for testing crash resilience.
