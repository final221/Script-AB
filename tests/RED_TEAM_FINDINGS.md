# Red Team Findings (Test Coverage Map)

Purpose: quick map of adversarial findings and where they are covered in tests.

## Findings Covered By Tests
1. Failover should prefer trusted candidates over higher-score untrusted ones.
Test: `tests/unit/FailoverCandidatePicker.test.js` (CHALLENGE)
2. Fast-switch should activate when healing stalls exceed configured thresholds.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
3. Untrusted preferred candidates must not switch outside probation.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
4. Active candidates that are not stalled should block switching.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
5. Probation windows must log start and end only once.
Test: `tests/unit/CandidateProbation.test.js` (CHALLENGE)
6. Adblock hints should default missing fields to unknown/null.
Test: `tests/unit/ExternalSignalHandlerAdblock.test.js` (CHALLENGE)
7. Buffer exhaustion checks should log buffer read failures.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
8. Buffer-ahead reporting should indicate no buffer when empty.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
9. No-heal-point refresh should fire when eligible and no emergency switch occurs.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
10. No-buffer rescans should route through probation policy hooks when available.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
11. Play-error backoff should be applied to the monitor state.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
12. Healpoint-stuck conditions should emit the proper log tag.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
13. Healpoint-stuck should trigger a rescan when probation is not engaged.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: confirm intended behavior in `docs/ARCHITECTURE.md` or Config docs, then keep or adjust the CHALLENGE test.
Decision: keep CHALLENGE for now to avoid locking in an unproven preference policy.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior and keep or adjust `tests/unit/CandidateSwitchPolicy.test.js` and `tests/unit/CandidateProbation.test.js`.
3. Recovery decision side effects (refresh vs probation vs rescan ordering, healpoint-stuck handling) are not specified.
Action: document expected behavior and keep or adjust `tests/unit/RecoveryDecisionApplier.test.js`.
Decision: keep CHALLENGE until we have more real-world evidence to justify sequencing.
