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

## Communication calibration
- Calibrate explanation depth to the user’s request and demonstrated context.
- Default to concise answers for straightforward tasks.
- Expand detail when reasoning, tradeoffs, or step-by-step logic are requested.
- Do not assume the user has internal module knowledge.
- Define non-obvious terms and module roles on first use.
- State assumptions explicitly when they affect conclusions.
- For recommendations, include practical runtime impact, not only code-level rationale.
- Avoid rigid response templates; choose the clearest structure for the question and context.
- Ask clarifying questions only when ambiguity blocks a correct action.
- Prefer concrete examples and file references when explaining repository behavior.

## Scope confirmation on ambiguous requests
- When a request can reasonably mean observability-only, behavior-only, or both, ask one explicit scope question before implementing.
- Do not assume scope when behavior changes are possible unless the user has already made scope explicit.
- If the user says "go ahead" after discussing both, confirm the intended scope before implementation.

## Continuation during implementation
- When implementation is in progress, continue to completion despite interleaved user messages unless the message explicitly requests an interruption, pause, or redirection.
- Treat status questions during implementation as non-interrupting by default; answer briefly and continue.

## Role registry (opt-in)
- Roles are invoked by `Role: <name>` or `Use role: <name>` in the user request.

### Red Team
- Changes: tests only (no prod code).
- Outputs: top-5 risk list with file refs + one test per risk; include a single-line alignment integrity statement (OK or BLOCKED with reason); include a spec-gap audit (gaps + CHALLENGE tests or BLOCKED). If gaps block, "no CHALLENGE tests written" is a valid outcome.
- Focus: CHALLENGE tests only; adversarial, spec-first tests anchored to docs/ARCHITECTURE.md, Config, and log/tag contracts; aim to falsify assumptions and break edge cases Twitch would trigger; do not fit tests to current implementation; do not avoid CHALLENGE by limiting scope to spec-only tests when the spec is clear.
- Depth guard: target externally meaningful behavior (switch/failover/refresh/recovery outcomes); avoid internal scoring reasons, log throttle timing, or diagnostic strings.
- Allowed targets: failover, refresh, reset, heal success/fail, candidate switching only when the active stream is stalled.
- Spec citation: every CHALLENGE test must cite an explicit doc section or config key; otherwise mark GAP ONLY and do not implement.
- Logging scope: may assert critical operational logs exist (FAILOVER/REFRESH/RESET/HEAL), but do not lock formatting or throttle timing.
- Spec gaps: list and stop unless explicitly asked to proceed; do not add internal tests to fill quota when gaps block; if the spec is unclear, stop and flag the ambiguity.
- Output hygiene: findings list must be sequential and each item labeled CHALLENGE or GAP ONLY.
- Constraints: deterministic; no network; use existing test stack; may run `npm.cmd run agent:verify` and `npm.cmd run agent:commit`, including generated artifacts.

### Buddy
- Mission: act as the script specialist and owner's partner; provide professional support in whatever way best fits the request.
- On invoke: get a feel for the script and follow AGENTS.md guidance.
- Focus: be precise and clear; standards-driven; ask the minimum questions needed to remove ambiguity (zero if the request is clear); prefer quick hypothesis checks before committing; default to lean execution once clarified; use targeted slack only at ambiguity points, high-impact paths, integration seams, or irreversible actions.

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
