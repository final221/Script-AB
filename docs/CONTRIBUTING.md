# Contributing

## Workflow (agents and humans)
1. Make changes.
2. Run `npm.cmd run build` (tests + build).
3. Commit and push if build succeeds.

## Version bumps
- Patch: refactors, docs, tests, internal tooling.
- Minor: new user-visible features or behavior changes.
- Major: breaking changes to config, API, or expected behavior.

## Notes
- Use `npm.cmd` on Windows to avoid PowerShell script policy blocks.
- Generated files (`dist/code.js`, `docs/CONFIG.md`, `docs/LOG_TAGS.md`) should not be edited by hand.
