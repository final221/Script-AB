# Twitch Stream Healer

Twitch stream healing userscript with comprehensive logging. When uBlock Origin blocks ads, this script detects buffer gaps and seeks to resume playback.

## Features

- **Stall Detection** - Monitors video playback for stuck states
- **Buffer Gap Analysis** - Finds "heal points" where new content is buffering
- **Automatic Seeking** - Seeks past gaps to resume playback
- **Comprehensive Logging** - Merged timeline of script logs + console output

## Quick Start

### Build
```bash
node build/build.js          # Patch: 4.0.5 → 4.0.6
node build/build.js --minor  # Minor: 4.0.5 → 4.1.0
node build/build.js --major  # Major: 4.0.5 → 5.0.0
```

Output: `dist/code.js`

### Install
1. Install a userscript manager (Tampermonkey, Violentmonkey)
2. Open `dist/code.js`
3. Copy contents to new userscript

### Debug
```javascript
getTwitchHealerStats()    // Get heal statistics
exportTwitchAdLogs()      // Download merged timeline (script + console logs)
```

## Project Structure

```
Tw Adb/
├── src/
│   ├── config/       # Configuration (1 file)
│   ├── utils/        # Utilities (2 files)
│   ├── core/         # Orchestration (2 files)
│   ├── recovery/     # Heal point finding & seeking (2 files)
│   └── monitoring/   # Logging & metrics (5 files)
├── build/            # Build scripts
├── dist/             # Build output
├── tests/            # Unit tests
└── docs/             # Documentation
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

## How It Works

1. **Detection**: `StreamHealer.monitor()` polls video element for stuck states
2. **Analysis**: `BufferGapFinder` scans buffer ranges for gaps
3. **Healing**: `LiveEdgeSeeker` seeks to heal point and resumes playback
4. **Logging**: All actions logged for debugging via `exportTwitchAdLogs()`

## Key Modules

| Module | Purpose |
|--------|---------|
| `CoreOrchestrator` | Entry point, initializes StreamHealer |
| `StreamHealer` | Main healing orchestrator |
| `BufferGapFinder` | Finds buffer gaps and heal points |
| `LiveEdgeSeeker` | Validates and seeks to heal points |
| `Logger` | Merged timeline collection |
| `Instrumentation` | Console capture for debugging |

## Configuration

Key settings in `Config.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `stall.WATCHDOG_INTERVAL_MS` | 1000 | How often the watchdog checks for stalls |
| `stall.STALL_CONFIRM_MS` | 2500 | No-progress window before healing |
| `stall.RETRY_COOLDOWN_MS` | 2000 | Cooldown between heal attempts |
| `stall.HEAL_TIMEOUT_S` | 15 | Give up finding heal point after |

## Version

Current: **4.0.15**

Version increments automatically on each build (patch).

