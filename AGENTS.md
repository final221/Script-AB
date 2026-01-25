# AGENTS.md

## Single entrypoint
- This file is the authoritative agent workflow. Keep other docs thin and refer back here.
- Avoid adding extra workflow/process docs (e.g., CONTRIBUTING, workflows) unless strictly necessary.

## Start
- docs/AI_CONTEXT.md
- docs/ARCHITECTURE.md

## Workflow (always)
1) Make changes
2) Run `npm.cmd run build`
3) Commit and push if build succeeds

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
