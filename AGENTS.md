# AGENTS.md

## Single entrypoint
- This file is the authoritative agent workflow. Keep other docs thin and refer back here.
- Avoid adding extra workflow/process docs (e.g., CONTRIBUTING, workflows) unless strictly necessary.
- Do not reintroduce one-line stubs (e.g., docs/CONTRIBUTING.md, docs/INDEX.md, docs/OWNERSHIP.md, .agent/workflows/*); fold content into AGENTS.md or docs/AI_CONTEXT.md instead.

## Efficiency-first stance
- Prioritize the thinnest, most direct path.
- If a request conflicts with the thin workflow, say no and propose the leaner alternative.
- Do not add extra process/docs unless required for correctness or safety.
- State recommendations plainly; base them on logic/efficiency, not assumed user desire.
- Do not ask the user to choose when a single best path exists; choose and proceed.
- Avoid "if you want" or optional suggestion phrasing; give a direct opinion on whether anything else should be done, or say explicitly that nothing else is needed.

## Start
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md

## Agent quick map
- Entry point: `src/core/orchestrators/CoreOrchestrator.js`
- Main logic: `src/core/orchestrators/StreamHealer.js`
- Playback: `src/core/playback/PlaybackMonitor.js`
- Recovery: `src/core/recovery/HealPipeline.js`
- Buffer + seek: `src/recovery/BufferGapFinder.js`, `src/recovery/LiveEdgeSeeker.js`
- Logging: `src/monitoring/Logger.js`, `src/monitoring/LogEvents.js`

## Workflow (always)
1) Make changes
2) Run `npm.cmd run agent:verify` after changes (tests + build + status; build bumps version + generates dist)
3) Commit and push if verify succeeds

- If build/test cannot run, stop and report why before making changes.
- Use `npm.cmd` on Windows to avoid PowerShell script policy blocks.

## Bump policy
- Patch: refactors, docs, tests, internal tooling
- Minor: new user-visible features or behavior changes
- Major: breaking changes to config, API, or expected behavior

## Constraints (do not violate)
- `dist/code.js` and `build/version.txt` are generated.
- Load order is controlled by `build/manifest.json` and `build/sync-docs.js`.
- Userscript output must remain dependency-free (no external runtime deps).
- Use `LogEvents` + `Logger` for logs; update LogTags when adding new tags.

## Quick refs (only if needed)
- docs/DEBUGGING.md
- docs/TUNING.md
- docs/CONFIG.md (generated)
- docs/LOG_TAGS.md (generated)
