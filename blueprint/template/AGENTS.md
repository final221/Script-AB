# AGENTS.md

## Single entrypoint
- This file is the authoritative workflow for this repository.
- Keep process rules here; keep other docs thin and focused on technical context.

## Efficiency-first stance
- Prefer the thinnest correct path.
- Do not introduce extra process unless required for correctness or safety.
- State recommendations directly and based on technical logic.

## Discussion-first
- During brainstorming/questions: do not edit files or run builds.
- Wait for explicit implementation confirmation before making changes.

## Workflow (always)
1) Make changes (and tests when behavior changes)
2) Choose bump and run: `BUMP=patch|minor|major npm run agent:verify`
3) Commit and push: `COMMIT_MSG="..." npm run agent:commit`

- If tests/build cannot run, stop and report why.
- Doc-only changes may skip `agent:verify` and generated artifacts.
- When reporting verify results, always include warning count (`0` when none).

## Bump policy
- Patch: refactors, docs, tests, internal tooling
- Minor: user-visible feature or behavior changes
- Major: breaking API/config/contract changes

## Module metadata and load order
- Every `src/**/*.js` file must declare `// @module <Name>`.
- Declare `// @depends <ModuleA, ModuleB, ...>` when initialization order matters.
- `build/manifest.json` is generated from metadata; do not hand-edit.
- Graph validation must fail on duplicate modules, unresolved dependencies, and cycles.

## Constraints
- `dist/code.js` and `build/version.txt` are generated.
- Keep source files roughly <=250 lines unless justified.
- Use shared logging abstractions for operational logs.
- Keep docs in sync with changed behavior and entrypoints.

## Start here
- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
