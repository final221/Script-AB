# Twitch Stream Healer

Twitch stream healing userscript with comprehensive logging. When uBlock Origin blocks ads, this script detects buffer gaps and seeks to resume playback.

## Features

- **Stall Detection** - Monitors video playback for stuck states
- **Buffer Gap Analysis** - Finds "heal points" where new content is buffering
- **Automatic Seeking** - Seeks past gaps to resume playback
- **Comprehensive Logging** - Merged timeline of script logs + console output

## Quick Start

### Agent Workflow
For agents, the single authoritative workflow and constraints live in `AGENTS.md`.

### Build
```bash
npm.cmd run build             # Patch: 4.0.5 -> 4.0.6
npm.cmd run build -- --minor   # Minor: 4.0.5 -> 4.1.0
npm.cmd run build -- --major   # Major: 4.0.5 -> 5.0.0
```

Output: `dist/code.js`

### Install
1. Install a userscript manager (Tampermonkey, Violentmonkey)
2. Open `dist/code.js`
3. Copy contents to new userscript

### Debug
```javascript
exportTwitchAdLogs()      // Download report (healer + metrics + logs)
```
See `docs/DEBUGGING.md` for log sequences and triage tips.

### Tuning
Quick knobs (see `docs/TUNING.md` for full mapping):
- `stall.INIT_PROGRESS_GRACE_MS` (initial progress grace window)
- `stall.FAILOVER_*` (failover timing + cooldown)
- `monitoring.CANDIDATE_*` (selection + scoring behavior)
- `monitoring.TRUST_STALE_MS` (trust decay)

## Generated Files
- `dist/code.js` is build output; do not edit by hand.
- `build/version.txt` is managed by `build/build.js` (via `npm.cmd run build`).

## Project Structure

```
Tw Adb/
|-- src/
|   |-- config/       # Configuration
|   |-- utils/        # Utilities + DOM adapters
|   |-- core/         # Core runtime logic
|   |   |-- orchestrators/ # Entry points + wiring
|   |   |-- playback/      # Playback monitoring + stall detection
|   |   |-- recovery/      # Heal pipeline + backoff/failover
|   |   |-- candidate/     # Candidate scoring/selection
|   |   |-- external/      # External signal handlers
|   |   |-- video/         # Video discovery + registry
|   |-- recovery/     # Buffer analysis + seeking
|   |-- monitoring/   # Logging, metrics, instrumentation
|-- build/            # Build scripts + manifest
|-- dist/             # Generated output (userscript)
|-- tests/            # Unit tests (Vitest + JSDOM)
|-- docs/             # Documentation
|-- data/             # Pattern data
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture.

## Docs & Navigation
- [AGENTS.md](AGENTS.md) - Single authoritative agent workflow and constraints
- [docs/AI_CONTEXT.md](docs/AI_CONTEXT.md) - AI agent context, constraints, load order
- [docs/DEBUGGING.md](docs/DEBUGGING.md) - Log sequences and triage guide
- [docs/CONFIG.md](docs/CONFIG.md) - Generated configuration defaults
- [docs/LOG_TAGS.md](docs/LOG_TAGS.md) - Generated log tag reference
- [docs/TUNING.md](docs/TUNING.md) - Configuration knobs and tuning workflow
- [tests/README.md](tests/README.md) - Test harness and conventions

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
See `docs/CONFIG.md` for the generated defaults and `docs/TUNING.md` for tuning guidance.

## Version

Current: **4.4.48**

Version increments automatically on each build (patch).
Changelog: `docs/CHANGELOG.md`







