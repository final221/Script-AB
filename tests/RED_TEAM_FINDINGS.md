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
5. Adblock hints should default missing fields to unknown/null.
Test: `tests/unit/ExternalSignalHandlerAdblock.test.js` (CHALLENGE)
6. Buffer exhaustion checks should log buffer read failures.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
7. Buffer-ahead reporting should indicate no buffer when empty.
Test: `tests/unit/BufferRanges.test.js` (CHALLENGE)
8. No-heal-point refresh should fire when eligible and no emergency switch occurs.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
9. No-buffer rescans should route through probation policy hooks when available.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
10. Play-error backoff should be applied to the monitor state.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
11. Healpoint-stuck conditions should emit the proper log tag.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
12. Healpoint-stuck should trigger a rescan when probation is not engaged.
Test: `tests/unit/RecoveryDecisionApplier.test.js` (CHALLENGE)
14. Monitor cap enforcement should prune the worst non-protected candidate.
Test: `tests/unit/CandidatePruner.test.js` (CHALLENGE)
15. Pruning should skip and log when all candidates are protected.
Test: `tests/unit/CandidatePruner.test.js` (CHALLENGE)
16. Candidate selection should respect the failover lock.
Test: `tests/unit/CandidateSelectionEngine.test.js` (CHALLENGE)
17. Candidate selection should fall back to the last known good candidate.
Test: `tests/unit/CandidateSelectionEngine.test.js` (CHALLENGE)
18. Trusted non-dead candidates should be preferred over dead candidates.
Test: `tests/unit/CandidateSelectionEngine.test.js` (CHALLENGE)
19. Candidate selection should return empty status when no monitors exist.
Test: `tests/unit/CandidateSelectionEngine.test.js` (CHALLENGE)
20. Candidate decisions should not be recomputed when preferred equals active.
Test: `tests/unit/CandidateSelectionEngine.test.js` (CHALLENGE)
21. Candidate scoring should penalize fallback sources and missing DOM membership.
Test: `tests/unit/CandidateScorer.test.js` (CHALLENGE)
22. Candidate scoring should mark dead candidates within the dead window.
Test: `tests/unit/CandidateScorer.test.js` (CHALLENGE)
23. Candidates without sufficient progress streak should be penalized.
Test: `tests/unit/CandidateScorer.test.js` (CHALLENGE)
24. Recent progress should be identified within the recent window.
Test: `tests/unit/CandidateScorer.test.js` (CHALLENGE)
25. Paused candidates should be penalized.
Test: `tests/unit/CandidateScorer.test.js` (CHALLENGE)
26. Non-interval candidate decisions should be logged immediately.
Test: `tests/unit/CandidateSelectionLogger.test.js` (CHALLENGE)
27. Interval decisions should be throttled by `ACTIVE_LOG_MS`.
Test: `tests/unit/CandidateSelectionLogger.test.js` (CHALLENGE)
28. Suppression summaries should emit after `SUPPRESSION_LOG_MS`.
Test: `tests/unit/CandidateSelectionLogger.test.js` (CHALLENGE)
29. Non-interval suppressions should not emit suppression summaries.
Test: `tests/unit/CandidateSelectionLogger.test.js` (CHALLENGE)
30. No logging should occur when the decision action is `none`.
Test: `tests/unit/CandidateSelectionLogger.test.js` (CHALLENGE)
31. Quiet windows should skip stall handling.
Test: `tests/unit/StallSkipPolicy.test.js` (CHALLENGE)
32. Backoff windows should skip stall handling.
Test: `tests/unit/StallSkipPolicy.test.js` (CHALLENGE)
33. Buffer starvation windows should skip stall handling.
Test: `tests/unit/StallSkipPolicy.test.js` (CHALLENGE)
34. Play backoff windows should skip stall handling.
Test: `tests/unit/StallSkipPolicy.test.js` (CHALLENGE)
35. Self-recover signals should skip stall handling.
Test: `tests/unit/StallSkipPolicy.test.js` (CHALLENGE)

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: confirm intended behavior in `docs/ARCHITECTURE.md` or Config docs, then keep or adjust the CHALLENGE test.
Decision: keep CHALLENGE for now to avoid locking in an unproven preference policy.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior and keep or adjust `tests/unit/CandidateSwitchPolicy.test.js` and `tests/unit/CandidateProbation.test.js`.
3. Recovery decision side effects (refresh vs probation vs rescan ordering, healpoint-stuck handling) are not specified.
Action: document expected behavior and keep or adjust `tests/unit/RecoveryDecisionApplier.test.js`.
Decision: keep CHALLENGE until we have more real-world evidence to justify sequencing.
4. Monitor-cap pruning rules (protected candidates, scoring tie-breakers) are not specified.
Action: document expected behavior and keep or adjust `tests/unit/CandidatePruner.test.js`.
5. Candidate selection fallbacks (lock behavior, last-good preference, dead candidate handling) are not specified.
Action: document expected behavior and keep or adjust `tests/unit/CandidateSelectionEngine.test.js`.
6. Candidate scoring weights and reasons are not specified in docs.
Action: document expected behavior and keep or adjust `tests/unit/CandidateScorer.test.js`.
7. Candidate selection logging throttles are not specified.
Action: document expected behavior and keep or adjust `tests/unit/CandidateSelectionLogger.test.js`.
8. Stall skip policy gating order and self-recover signals are not specified.
Action: document expected behavior and keep or adjust `tests/unit/StallSkipPolicy.test.js`.
