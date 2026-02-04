# Red Team Findings (Test Coverage Map)

Purpose: quick map of adversarial findings and where they are covered in tests.

## Findings Covered By Tests
1. CHALLENGE: Failover should revert to the previous candidate when the failover target makes no progress.
Test: `tests/unit/FailoverManager.test.js`
2. CHALLENGE: Prolonged stalls should trigger failover even before no-heal thresholds.
Test: `tests/unit/NoHealPointPolicy.test.js`
3. CHALLENGE: Emergency switching should reject unready or missing-src candidates.
Test: `tests/unit/EmergencyCandidatePicker.test.js`
4. CHALLENGE: Low-headroom heal points should be rejected unless gap-override criteria are met.
Test: `tests/unit/HealPointPoller.test.js`
5. CHALLENGE: No-heal refresh delay windows should block refresh until the delay elapses.
Test: `tests/unit/RecoveryManager.test.js`
6. GAP ONLY: Failover should prefer trusted candidates over higher-score untrusted ones.
Test: `tests/unit/FailoverCandidatePicker.test.js`
7. GAP ONLY: Fast-switch should activate when healing stalls exceed configured thresholds.
Test: `tests/unit/CandidateSwitchPolicy.test.js`
8. GAP ONLY: Untrusted preferred candidates must not switch outside probation.
Test: `tests/unit/CandidateSwitchPolicy.test.js`
9. GAP ONLY: Active candidates that are not stalled should block switching.
Test: `tests/unit/CandidateSwitchPolicy.test.js`

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: document expected behavior before treating this as a CHALLENGE test.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior before treating these as CHALLENGE tests.
