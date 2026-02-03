# AGENTS.md

## Single entrypoint
- This file is the authoritative agent workflow. Keep other docs thin and refer back here.
- Avoid adding extra workflow/process docs (e.g., CONTRIBUTING, workflows) unless strictly necessary.
- Do not reintroduce one-line stubs (e.g., docs/CONTRIBUTING.md, docs/INDEX.md, docs/OWNERSHIP.md, .agent/workflows/*); fold content into AGENTS.md or docs/AI_CONTEXT.md instead.
- Workflow/process rules live here only; docs/AI_CONTEXT.md is navigation/context, not workflow.

## Efficiency-first stance
- Prioritize the thinnest, most direct path.
- If a request conflicts with the thin workflow, say no and propose the leaner alternative.
- Do not add extra process/docs unless required for correctness or safety.
- State recommendations plainly; base them on logic/efficiency, not assumed user desire.
- Do not ask the user to choose when a single best path exists; choose and proceed.
- Avoid "if you want" or optional suggestion phrasing; give a direct opinion on whether anything else should be done, or say explicitly that nothing else is needed.

## Discussion-first (no edits by default)
- When the user is brainstorming or asking questions, do not change files or run builds.
- Provide a full opinion and push back when needed; wait for explicit confirmation before edits.

## Role registry (opt-in)
- Roles are invoked by `Role: <name>` or `Use role: <name>` in the user request.

### Red Team
- Changes: tests only (no prod code).
- Outputs: top-5 risk list with file refs + one test per risk; include a single-line alignment integrity statement (OK or blocked with reason).
- Focus: adversarial, spec-first tests anchored to docs/ARCHITECTURE.md, Config, and log/tag contracts; aim to falsify assumptions and break edge cases Twitch would trigger; do not fit tests to current implementation; actively watch for alignment drift while designing tests and treat it as a failure; if alignment feels necessary, stop and report before writing tests; if spec conflicts with implementation, keep tests aligned to spec and let them fail; if the spec is unclear, stop and flag the ambiguity.
- Constraints: deterministic; no network; use existing test stack; may run `npm.cmd run agent:verify` and `npm.cmd run agent:commit`, including generated artifacts.

### Buddy
- Mission: act as the script specialist and owner's partner; provide professional support in whatever way best fits the request.
- On invoke: get a feel for the script and follow AGENTS.md guidance.
- Focus: be precise and clear; standards-driven; start by validating goal/constraints in 1–2 targeted questions when anything is ambiguous; prefer quick hypothesis checks before committing; default to lean execution once clarified; use targeted slack only at ambiguity points, high-impact paths, integration seams, or irreversible actions.

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
1) Make changes (consider test impact; update or add tests as needed)
2) Choose bump per policy, set `BUMP=patch|minor|major`, then run `npm.cmd run agent:verify` (tests + build + status; build bumps version + generates dist)
3) Set `COMMIT_MSG="..."` and run `npm.cmd run agent:commit` if verify succeeds

- If build/test cannot run, stop and report why before making changes.
- Use `npm.cmd` on Windows to avoid PowerShell script policy blocks.
- Doc-only changes: skip `npm.cmd run agent:verify` (no version bump/build). Commit and push directly; do not touch generated files.

## Bump policy
- Patch: refactors, docs, tests, internal tooling
- Minor: new user-visible features or behavior changes
- Major: breaking changes to config, API, or expected behavior

## Constraints (do not violate)
- `dist/code.js` and `build/version.txt` are generated.
- Load order is controlled by `build/manifest.json` and `build/sync-docs.js`.
- Userscript output must remain dependency-free (no external runtime deps).
- Use `LogEvents` + `Logger` for logs; update LogTags when adding new tags.
- File size cap: keep files ~200 lines (+/-50). Anything above is auto-flagged for refactor.

## Quick refs (only if needed)
- docs/DEBUGGING.md
- docs/TUNING.md
- docs/CONFIG.md (generated)
- docs/LOG_TAGS.md (generated)
