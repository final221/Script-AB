# AGENTS.md Template

Copy this file to a target repository as `AGENTS.md`.
If you want the standardized `agent:verify` / `agent:commit` workflow, copy `AGENT_WORKFLOW_TEMPLATE.js` into that repo as well, usually as `build/agent-workflow.js`.
Then replace placeholders and delete sections that do not apply.

## Single entrypoint
- This file is the authoritative agent workflow. Keep other docs thin and refer back here.
- Avoid adding extra workflow/process docs (for example `CONTRIBUTING`, workflows, or agent-specific stubs) unless strictly necessary.
- Do not reintroduce one-line stubs; fold process rules into `AGENTS.md` or the project context docs instead.
- Workflow/process rules live here only. Context/navigation docs are for architecture and orientation, not process.

## Efficiency-first stance
- Prioritize the thinnest, most direct path.
- If a request conflicts with the thin workflow, say no and propose the leaner alternative.
- Do not add extra process or docs unless required for correctness or safety.
- State recommendations plainly; base them on logic and efficiency, not assumed user desire.
- Do not ask the user to choose when one path is clearly best; choose and proceed.
- Avoid optional-sounding phrasing when a direct recommendation is available.

## Honesty over agreeableness
- Prefer the most decision-useful answer over the most comfortable one.
- When a plan, assumption, or request is weak, say so plainly and explain why.
- Do not soften negative technical judgment into vague "things to consider."
- Do not add praise or encouragement unless it is materially justified.

## Discussion-first (no edits by default)
- When the user is brainstorming or asking questions, do not change files or run builds.
- Provide a full opinion and push back when needed; wait for explicit confirmation before edits.

## Communication calibration
- Calibrate explanation depth to the user's request and demonstrated context.
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
- If the user says "go ahead" after discussing multiple scopes, confirm the intended one before implementation.

## Continuation during implementation
- When implementation is in progress, continue to completion despite interleaved user messages unless the message explicitly requests an interruption, pause, or redirection.
- Treat status questions during implementation as non-interrupting by default; answer briefly and continue.

## Start
- `AGENT_WORKFLOW_TEMPLATE.js` (or the repo-local file copied from it, typically `build/agent-workflow.js`) if the repo uses the standardized `agent:verify` / `agent:commit` entrypoints
- `<PROJECT_CONTEXT_DOC>`
- `<PROJECT_ARCHITECTURE_DOC>`

## Agent quick map
- Entry point: `<ENTRYPOINT_FILE_OR_DIR>`
- Main logic: `<MAIN_LOGIC_FILE_OR_DIR>`
- Core subsystem A: `<SUBSYSTEM_A>`
- Core subsystem B: `<SUBSYSTEM_B>`
- Core subsystem C: `<SUBSYSTEM_C>`
- Logging / observability: `<LOGGING_FILES_OR_DIR>`

## Workflow (always)
1) Make changes (consider test impact; update or add tests as needed)
2) Choose bump per policy, set `BUMP=patch|minor|major|none`, then run the repo's `agent:verify`
3) Set `COMMIT_MSG="..."` and run the repo's `agent:commit` if verify succeeds

- If build or test cannot run, stop and report why before making changes.
- Preferred workflow entrypoints are `agent:verify` and `agent:commit`.
- Preferred workflow inputs are `BUMP=patch|minor|major|none` for verification and `COMMIT_MSG="..."` for commit.
- `agent:verify` should honor `BUMP` directly or document that the repo intentionally ignores it.
- `agent:commit` should require `COMMIT_MSG` (or document a clearly named equivalent).
- If the repo does not implement those entrypoints yet, either wire them up or replace `<VERIFY_COMMAND>` / `<COMMIT_COMMAND>` with the real equivalents.
- The preferred single-file starting point for those entrypoints is `AGENT_WORKFLOW_TEMPLATE.js`, usually copied into the target repo as `build/agent-workflow.js`.
- Document shell-specific command variants if the repo needs them.
- Define whether a no-bump or local-only verify mode exists: `<NO_BUMP_POLICY>`.
- For doc-only changes, state whether verification can be skipped: `<DOC_ONLY_POLICY>`.
- When reporting verification results, always include warning counts if the repo exposes them.
- Documentation sync is mandatory: whenever code, config, behavior, logging, interfaces, or debug hooks change, update the corresponding docs in the same change set.

## Structural contracts (optional; keep only if applicable)
- Source contract: `<PER_FILE_METADATA_OR_HEADER_RULES>`
- Generated artifacts: `<GENERATED_METADATA_OR_MANIFEST_FILES>`
- Ordering / graph mode: `<LOAD_ORDER_OR_BUILD_GRAPH_RULES>`
- Verification gates: `<STRUCTURAL_CHECKS_AND_FAILURE_RULES>`
- Maintenance rules: update structural metadata and generated outputs in the same change.
- Warning target: keep structural warning count at `0` in normal operation.

## Bump / release policy
- Preferred interface: `BUMP=patch|minor|major|none` passed into `agent:verify`
- Patch: refactors, docs, tests, internal tooling
- Minor: new user-visible features or behavior changes
- Major: breaking changes to config, API, or expected behavior
- None / local-only: exploratory or local verification only; no release artifact version or changelog change

## Constraints (do not violate)
- Generated files: `<GENERATED_FILES>`
- Packaging / build constraints: `<PACKAGING_CONSTRAINTS>`
- Runtime constraints: `<RUNTIME_CONSTRAINTS>`
- Logging / observability contract: `<LOGGING_CONTRACT>`
- File size / refactor threshold: `<SIZE_POLICY>`
- Public hooks / entrypoint changes must update: `<HOT_PATH_DOCS>`
- Keep docs explicitly in sync with the changed surface:
- Architecture / flow / subsystem interaction docs -> `<ARCHITECTURE_DOC>`
- Navigation / hot paths / debug hooks / AI orientation docs -> `<CONTEXT_DOC>`
- Debugging / operations docs -> `<DEBUGGING_DOC>`
- Tuning / thresholds / knobs docs -> `<TUNING_DOC>`
- Generated config / schema / log contract docs -> `<GENERATED_REFERENCE_DOCS>`

## Quick refs (only if needed)
- `<DEBUGGING_DOC>`
- `<TUNING_DOC>`
- `<GENERATED_CONFIG_DOC>`
- `<GENERATED_LOG_DOC>`

## Template notes
- Replace every `<PLACEHOLDER>` before using this file as the repo's live `AGENTS.md`.
- Delete sections that do not apply instead of leaving vague or half-configured rules behind.
- Keep the file opinionated. A weaker but more generic `AGENTS.md` is worse than a shorter one with real project decisions.
