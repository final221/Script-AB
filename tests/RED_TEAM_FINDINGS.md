# Red Team Findings (Test Coverage Map)

Purpose: quick map of adversarial findings and where they are covered in tests.

## Findings Covered By Tests
1. Failover cooldown must prevent rapid re-attempts.
Test: `tests/unit/FailoverManager.test.js`
2. Failover should prefer trusted candidates over higher-score untrusted ones.
Test: `tests/unit/FailoverCandidatePicker.test.js` (CHALLENGE)
3. No-heal-point last-resort switching must require buffer starvation when configured.
Test: `tests/unit/NoHealPointPolicy.test.js`
4. Play-error failover should trigger at `FAILOVER_AFTER_PLAY_ERRORS` with multiple monitors.
Test: `tests/unit/PlayErrorPolicy.test.js`
5. Unhandled external signals must log with correct tag and message truncation.
Test: `tests/unit/ExternalSignalHandlerFallback.test.js`

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: confirm intended behavior in `docs/ARCHITECTURE.md` or Config docs, then keep or adjust the CHALLENGE test.
