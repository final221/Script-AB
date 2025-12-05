# Mega Ad Dodger 3000 (Stealth Reactor Core)

Twitch ad blocker userscript with comprehensive logging and gentle recovery.

## Features

- **Network Interception** - Blocks ad requests at the network level
- **Health Monitoring** - Detects stuck playback (with high tolerance thresholds)
- **Gentle Recovery** - Passive approach: try play(), minimal seeking, no page reload
- **Comprehensive Logging** - Merged timeline of script logs + console output
- **Auto-Versioning** - Semantic versioning with automatic patch increments

## Quick Start

### Build
```bash
node build/build.js          # Patch: 3.0.2 → 3.0.3
node build/build.js --minor  # Minor: 3.0.2 → 3.1.0
node build/build.js --major  # Major: 3.0.2 → 4.0.0
```

Output: `dist/code.js`

### Install
1. Install a userscript manager (Tampermonkey, Violentmonkey)
2. Open `dist/code.js`
3. Copy contents to new userscript

### Debug
```javascript
exportTwitchAdLogs()  // Downloads merged timeline (script + console logs)
```

## Project Structure

```
Tw Adb/
├── src/              # Source modules
│   ├── config/       # Configuration (1)
│   ├── utils/        # Utilities & logic (7)
│   ├── core/         # Orchestration (5)
│   ├── network/      # Network layer (7)
│   ├── health/       # Health monitoring (4)
│   ├── recovery/     # Recovery strategies (12)
│   ├── player/       # Player interaction (5)
│   └── monitoring/   # Logging & metrics (6)
├── build/            # Build scripts
├── dist/             # Build output
├── logs/             # Runtime logs (gitignored)
└── docs/             # Documentation
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

## v3.0 Changes

### Recovery Overhaul
- **Disabled** AggressiveRecovery (was causing player destruction)
- **Disabled** page reload fallback
- **Increased** stuck detection thresholds (0.1s/2 → 0.5s/5)
- **Increased** stall debounce (10s → 30s)
- **Simplified** StandardRecovery (play first, seek fallback)

### Enhanced Logging
- Console capture (log, warn, error) with timestamps
- Merged timeline export for debugging
- Video segment/manifest request tracking
- Prefixed log categories for filtering

## Key Modules

- `CoreOrchestrator` - Main entry point
- `NetworkManager` - XHR/Fetch interception
- `ResilienceOrchestrator` - Gentle recovery coordination
- `Instrumentation` - Console capture & stall detection
- `Logger` - Merged timeline collection

## Version

Current: **3.0.3**

Version increments automatically on each build (patch).

