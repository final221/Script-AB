# Red Team Findings (Test Coverage Map)

Purpose: quick map of adversarial findings and where they are covered in tests.

## Findings Covered By Tests
1. GAP ONLY: Failover should prefer trusted candidates over higher-score untrusted ones.
Test: `tests/unit/FailoverCandidatePicker.test.js`
2. GAP ONLY: Fast-switch should activate when healing stalls exceed configured thresholds.
Test: `tests/unit/CandidateSwitchPolicy.test.js`
3. GAP ONLY: Untrusted preferred candidates must not switch outside probation.
Test: `tests/unit/CandidateSwitchPolicy.test.js`
4. GAP ONLY: Active candidates that are not stalled should block switching.
Test: `tests/unit/CandidateSwitchPolicy.test.js`
5. CHALLENGE: Heal polling must honor HEAL_TIMEOUT_S and escalate no-heal-point handling.
Test: `tests/unit/HealPipelinePoller.test.js`
6. CHALLENGE: Stall handling must debounce heal attempts within RETRY_COOLDOWN_MS after progress.
Test: `tests/unit/StallHandler.test.js`
7. CHALLENGE: Failover must trigger after FAILOVER_AFTER_STALL_MS even before no-heal-point thresholds.
Test: `tests/unit/NoHealPointPolicy.test.js`
8. CHALLENGE: Monitor caps must prune the lowest-score non-protected candidate when MAX_VIDEO_MONITORS is exceeded.
Test: `tests/unit/CandidatePruner.test.js`
9. CHALLENGE: Failover must revert to the original candidate if no progress occurs within FAILOVER_PROGRESS_TIMEOUT_MS.
Test: `tests/unit/FailoverManager.test.js`
10. CHALLENGE: Emergency switching must respect NO_HEAL_POINT_EMERGENCY_COOLDOWN_MS.
Test: `tests/unit/NoHealPointPolicy.test.js`
11. CHALLENGE: Refresh eligibility must open after NO_HEAL_POINT_REFRESH_DELAY_MS elapses.
Test: `tests/unit/NoHealPointPolicy.test.js`
12. CHALLENGE: Catch-up retries must stop after CATCH_UP_MAX_ATTEMPTS when playback stays unstable.
Test: `tests/unit/CatchUpController.test.js`
13. CHALLENGE: Buffer-starved rescans must be throttled by BUFFER_STARVE_RESCAN_COOLDOWN_MS.
Test: `tests/unit/StallHandler.test.js`
14. CHALLENGE: Play-stuck refresh must trigger after PLAY_STUCK_REFRESH_AFTER on a single monitor.
Test: `tests/unit/RecoveryManager.test.js`

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: document expected behavior before treating this as a CHALLENGE test.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior before treating these as CHALLENGE tests.
