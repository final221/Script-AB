# Blueprint Kit

This folder defines a reusable repository blueprint so new projects can inherit the same operating model used here:

- agent-centric workflow (`agent:verify`, `agent:commit`)
- semantic module metadata (`@module`, `@depends`)
- graph-based load-order generation and validation
- generated docs synchronization (`CONFIG`, `LOG_TAGS`, architecture load order)
- guardrails for file size, manifest metadata, and dependency cycles

## Scaffold a New Repo

From this repository:

```bash
npm run blueprint:scaffold -- --target ../my-new-repo --name my-new-repo --title "My New Repo" --description "My project description"
```

Then in the generated repository:

```bash
npm install
npm run agent:verify
```

## What Gets Seeded

- Portable build/verification scripts copied from this repository's `build/`
- Template project files from `blueprint/template/`:
- `AGENTS.md`
- base docs (`AI_CONTEXT`, `ARCHITECTURE`, `DEBUGGING`, `TUNING`, `CHANGELOG`)
- minimal `src/` runtime with module metadata
- minimal tests and vitest config
- package scripts aligned to the agent workflow

## Notes

- The generated repo starts intentionally minimal but fully wired for the same process behavior.
- `build/manifest.json`, `docs/CONFIG.md`, and `docs/LOG_TAGS.md` are initialized during scaffold.
