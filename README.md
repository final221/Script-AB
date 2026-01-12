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
See `docs/DEBUGGING.md` for log sequences and triage tips.

### Tuning
Quick knobs (see `docs/DEBUGGING.md` for full mapping):
- `stall.INIT_PROGRESS_GRACE_MS` (initial progress grace window)
- `stall.FAILOVER_*` (failover timing + cooldown)
- `monitoring.CANDIDATE_*` (selection + scoring behavior)
- `monitoring.TRUST_STALE_MS` (trust decay)

### Contributing
Run `npm test` and `npm run build` before committing changes.

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
| `stall.STALL_CONFIRM_BUFFER_OK_MS` | 1500 | Extra delay when buffer looks healthy |
| `stall.PAUSED_STALL_GRACE_MS` | 3000 | Allow stall detection shortly after pause |
| `stall.INIT_PROGRESS_GRACE_MS` | 5000 | Wait for initial progress before treating as stalled |
| `stall.RETRY_COOLDOWN_MS` | 2000 | Cooldown between heal attempts |
| `stall.HEAL_TIMEOUT_S` | 15 | Give up finding heal point after |
| `stall.NO_HEAL_POINT_BACKOFF_BASE_MS` | 5000 | Base backoff after no heal point |
| `stall.NO_HEAL_POINT_BACKOFF_MAX_MS` | 60000 | Max backoff after repeated no heal points |
| `stall.FAILOVER_AFTER_NO_HEAL_POINTS` | 3 | Failover after this many consecutive no-heal points |
| `stall.FAILOVER_AFTER_STALL_MS` | 30000 | Failover after this long without progress |
| `stall.FAILOVER_PROGRESS_TIMEOUT_MS` | 8000 | Trial window for failover candidate to progress |
| `stall.FAILOVER_COOLDOWN_MS` | 30000 | Minimum time between failover attempts |
| `monitoring.MAX_VIDEO_MONITORS` | 8 | Max concurrent video elements to monitor |
| `monitoring.CANDIDATE_SWITCH_DELTA` | 2 | Score delta required to switch active video |
| `monitoring.CANDIDATE_MIN_PROGRESS_MS` | 5000 | Minimum sustained progress before switching to new video |
| `monitoring.PROGRESS_STREAK_RESET_MS` | 2500 | Reset progress streak after this long without progress |
| `monitoring.PROGRESS_RECENT_MS` | 2000 | "Recent progress" scoring threshold |
| `monitoring.PROGRESS_STALE_MS` | 5000 | "Stale progress" scoring threshold |
| `monitoring.TRUST_STALE_MS` | 8000 | Trust expires if progress is older than this |
| `monitoring.PROBE_COOLDOWN_MS` | 5000 | Min time between probe attempts per candidate |
| `recovery.MIN_HEAL_BUFFER_S` | 2 | Minimum buffered seconds needed to heal |
| `recovery.SEEK_SETTLE_MS` | 100 | Wait after seek before validation |
| `recovery.PLAYBACK_VERIFY_MS` | 200 | Wait after play to verify playback |
| `logging.ACTIVE_LOG_MS` | 5000 | Active candidate log interval |
| `logging.NON_ACTIVE_LOG_MS` | 300000 | Non-active candidate log interval |
| `logging.BACKOFF_LOG_INTERVAL_MS` | 5000 | Backoff skip log interval |
| `logging.CONSOLE_SIGNAL_THROTTLE_MS` | 2000 | Throttle console hint signals |
| `logging.RESOURCE_HINT_THROTTLE_MS` | 2000 | Throttle resource hint signals |
| `logging.LOG_MESSAGE_MAX_LEN` | 300 | Max length for log messages |
| `logging.LOG_REASON_MAX_LEN` | 200 | Max length for error reasons |
| `logging.LOG_URL_MAX_LEN` | 200 | Max length for logged URLs |
| `logging.CONSOLE_CAPTURE_MAX_LEN` | 500 | Max length for captured console lines |
| `logging.MAX_LOGS` | 5000 | Max in-memory script logs |
| `logging.MAX_CONSOLE_LOGS` | 2000 | Max in-memory console logs |

## Version

Current: **4.1.0**

Version increments automatically on each build (patch).
Changelog: `docs/CHANGELOG.md`

