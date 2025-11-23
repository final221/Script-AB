# Mega Ad Dodger 3000 (Stealth Reactor Core)

Twitch ad blocker userscript with self-healing recovery mechanisms.

## Features

- **Network Interception** - Blocks ad requests at the network level
- **Health Monitoring** - Detects stuck playback, frame drops, A/V sync issues
- **Recovery Strategies** - Standard (seek) and aggressive (stream refresh) recovery
- **Auto-Versioning** - Semantic versioning with automatic patch increments

## Quick Start

### Build
```bash
node build/build.js          # Patch: 2.0.5 → 2.0.6
node build/build.js --minor  # Minor: 2.0.5 → 2.1.0
node build/build.js --major  # Major: 2.0.5 → 3.0.0
```

Output: `dist/code.js`

### Install
1. Install a userscript manager (Tampermonkey, Violentmonkey)
2. Open `dist/code.js`
3. Copy contents to new userscript

## Project Structure

```
Tw Adb/
├── src/              # Source modules (31 total)
│   ├── config/       # Configuration (1)
│   ├── utils/        # Utilities (3)
│   ├── core/         # Orchestration (5)
│   ├── network/      # Network layer (4)
│   ├── health/       # Health monitoring (4)
│   ├── recovery/     # Recovery strategies (6)
│   ├── player/       # Player interaction (2)
│   └── monitoring/   # Logging & metrics (5)
├── build/            # Build scripts
│   ├── build.js      # Main build script
│   ├── header.js     # UserScript metadata
│   └── version.txt   # Current version
├── dist/             # Build output
│   └── code.js       # Final bundled script
├── logs/             # Runtime logs (gitignored)
└── docs/             # Documentation
    └── ARCHITECTURE.md
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture and module dependencies.

## Development

### Module Organization
- **31 modules**, average 50 lines each
- **Low complexity**: 87% of modules
- **Strategy pattern** for recovery selection
- **Orchestrator pattern** for coordination

### Key Modules
- `CoreOrchestrator` - Main entry point
- `NetworkManager` - XHR/Fetch interception
- `ResilienceOrchestrator` - Recovery coordination
- `HealthMonitor` - Playback health checks

## Version

Current: **2.0.5**

Version increments automatically on each build (patch).
