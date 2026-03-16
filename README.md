# Twitch Stream Healer

Twitch stream healing userscript with comprehensive logging. When Twitch playback degrades after ad blocking or player churn, the script monitors the active video, evaluates alternate candidates, and applies seek/failover/refresh recovery.

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
Twitch Stream Healer/
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

1. **Detection**: `PlaybackMonitor` combines event handlers and a watchdog to detect stalls, resets, and dead-end playback.
2. **Selection**: `CandidateSelector` scores monitored video elements and tracks the active candidate for recovery.
3. **Recovery**: `HealPipeline`, failover, and refresh coordination try seek, switch, and reload paths in that order.
4. **Logging**: `Instrumentation` and `Logger` capture script actions plus browser hints for `exportTwitchAdLogs()`.

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

Current: **4.15.4**

Version increments on bumping builds (patch by default).
Changelog: `docs/CHANGELOG.md`







