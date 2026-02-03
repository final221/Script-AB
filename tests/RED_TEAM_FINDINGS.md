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
6. Fast-switch should activate when healing stalls exceed configured thresholds.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
7. Untrusted preferred candidates must not switch outside probation.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
8. Active candidates that are not stalled should block switching.
Test: `tests/unit/CandidateSwitchPolicy.test.js` (CHALLENGE)
9. Probation windows must log start and end only once.
Test: `tests/unit/CandidateProbation.test.js` (CHALLENGE)
10. Progress streaks must reset after long gaps.
Test: `tests/unit/PlaybackProgressTracker.test.js` (CHALLENGE)
11. Candidates must become eligible after minimum progress duration.
Test: `tests/unit/PlaybackProgressTracker.test.js` (CHALLENGE)
12. Initial progress grace window should skip stall handling.
Test: `tests/unit/PlaybackProgressLogic.test.js` (CHALLENGE)
13. Stall handling should resume after grace window expires.
Test: `tests/unit/PlaybackProgressLogic.test.js` (CHALLENGE)
14. Progress should clear heal/play backoff counters.
Test: `tests/unit/PlaybackProgressReset.test.js` (CHALLENGE)
15. Adblock hints should default missing fields to unknown/null.
Test: `tests/unit/ExternalSignalHandlerAdblock.test.js` (CHALLENGE)
16. Playhead attribution should fall back to active candidate on invalid playhead.
Test: `tests/unit/PlayheadAttribution.test.js` (CHALLENGE)
17. Playhead attribution should select the closest candidate within the match window.
Test: `tests/unit/PlayheadAttribution.test.js` (CHALLENGE)
18. Ad-gap detection should only trigger near buffered edges.
Test: `tests/unit/AdGapSignals.test.js` (CHALLENGE)
19. Ad-gap logging should throttle within the backoff interval.
Test: `tests/unit/AdGapSignals.test.js` (CHALLENGE)
20. Seek targets must respect edge guards on small buffers.
Test: `tests/unit/SeekTargetCalculator.test.js` (CHALLENGE)
21. Seek targets should preserve at least 1s of headroom when available.
Test: `tests/unit/SeekTargetCalculator.test.js` (CHALLENGE)
22. Seek target validation must return the correct buffer range.
Test: `tests/unit/SeekTargetCalculator.test.js` (CHALLENGE)
23. Buffer exhaustion checks should log buffer read failures.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
24. Buffer-ahead reporting should indicate no buffer when empty.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
25. No-heal-point refresh should fire when eligible and no emergency switch occurs.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
26. No-buffer rescans should route through probation policy hooks when available.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
27. Play-error backoff should be applied to the monitor state.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
28. Healpoint-stuck conditions should emit the proper log tag.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
29. Healpoint-stuck should trigger a rescan when probation is not engaged.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: confirm intended behavior in `docs/ARCHITECTURE.md` or Config docs, then keep or adjust the CHALLENGE test.
Decision: keep CHALLENGE for now to avoid locking in an unproven preference policy.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior and keep or adjust `tests/unit/CandidateSwitchPolicy.test.js` and `tests/unit/CandidateProbation.test.js`.
3. Progress tracking semantics (grace window, streak reset, eligibility) are not specified beyond config thresholds.
Action: document expected behavior and keep or adjust the PlaybackProgress* CHALLENGE tests.
4. Playhead attribution matching and ad-gap detection thresholds are not described in the architecture docs.
Action: document expected behavior and keep or adjust `tests/unit/PlayheadAttribution.test.js` and `tests/unit/AdGapSignals.test.js`.
5. Seek target calculation invariants (edge guards, headroom) are not specified in docs.
Action: document expected behavior and keep or adjust `tests/unit/SeekTargetCalculator.test.js`.
6. Recovery decision side effects (refresh vs probation vs rescan ordering, healpoint-stuck handling) are not specified.
Action: document expected behavior and keep or adjust `tests/unit/RecoveryDecisionApplier.test.js`.
Decision: keep CHALLENGE until we have more real-world evidence to justify sequencing.
