# AGENTS.md

## Project
Twitch Stream Healer (userscript)

## Start here
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md
- docs/CONFIG.md (generated)
- docs/LOG_TAGS.md (generated)
- docs/DEBUGGING.md
- docs/TUNING.md

## Build and test
- npm test (runs build/sync-docs.js --check)
- npm run build (sync-docs + tests + dist/code.js)
- node build/build.js [--minor|--major] (bumps version + changelog)

## Constraints
- dist/code.js and build/version.txt are generated.
- Load order is controlled by build/manifest.json and enforced by build/sync-docs.js.
- Userscript output must remain dependency-free (no external runtime deps).
- Use LogEvents + Logger for logs; update LogTags when adding new tags.

## Core layout
- src/core/orchestrators for entry points and wiring
- src/core/playback for monitoring and stall detection
- src/core/recovery for heal pipeline, backoff, failover
- src/core/candidate for scoring and selection
- src/core/external for external signals
- src/core/video for discovery and monitor registry
