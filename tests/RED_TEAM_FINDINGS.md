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

## Spec Gaps Requiring Review
1. Failover candidate selection: the spec does not state whether trusted candidates must be preferred over higher-score untrusted ones.
Action: document expected behavior before treating this as a CHALLENGE test.
2. Candidate switching and probation gating rules (fast switch, untrusted suppression, active-not-stalled blocking) are not defined in the architecture docs.
Action: document expected behavior before treating these as CHALLENGE tests.
