# Changelog

## 4.1.30 - 2026-01-24T11:41:36.452Z
Previous: 4.1.29
Commit: ef7b71f
Changes:
- Reduce stall noise and ignore Apollo errors

## 4.1.29 - 2026-01-24T11:28:39.524Z
Previous: 4.1.28
Commit: b8f032c
Changes:
- Refactor recovery logging and state

## 4.1.28 - 2026-01-24T11:20:32.950Z
Previous: 4.1.27
Commit: 4a3bb98
Changes:
- Log ad-gap signature and resource windows

## 4.1.27 - 2026-01-24T10:34:47.900Z
Previous: 4.1.26
Commit: 3488af0
Changes:
- Log adblock and ad-resource signals

## 4.1.26 - 2026-01-24T10:27:35.991Z
Previous: 4.1.25
Commit: ded26ae
Changes:
- Allow low-headroom gap heals

## 4.1.25 - 2026-01-24T10:16:55.427Z
Previous: 4.1.24
Commit: 103172f
Changes:
- Remove stats command and merge report header

## 4.1.24 - 2026-01-24T10:05:56.771Z
Previous: 4.1.23
Commit: 82d322c
Changes:
- Defer heals during self-recovery window

## 4.1.23 - 2026-01-24T09:56:59.171Z
Previous: 4.1.22
Commit: 200d00a
Changes:
- Add stall duration summary and abort context

## 4.1.22 - 2026-01-24T09:42:42.272Z
Previous: 4.1.21
Commit: 96cedc9
Changes:
- Fold healer stats into ad log export

## 4.1.21 - 2026-01-24T09:24:50.671Z
Previous: 4.1.20
Commit: 6c41159
Changes:
- Export healer stats snapshot

## 4.1.20 - 2026-01-24T09:18:27.138Z
Previous: 4.1.19
Commit: ae94eec
Changes:
- x

## 4.1.19 - 2026-01-14T14:05:31.624Z
Previous: 4.1.18
Commit: 52df8dd
Changes:
- Fix refresh helper reference

## 4.1.18 - 2026-01-14T12:46:43.301Z
Previous: 4.1.17
Commit: dfa1a9b
Changes:
- Force refresh after persistent heals

## 4.1.17 - 2026-01-14T12:00:12.378Z
Previous: 4.1.16
Commit: e02bd88
Changes:
- Defer heals on tiny buffer headroom

## 4.1.16 - 2026-01-14T10:22:28.578Z
Previous: 4.1.15
Commit: 99a3085
Changes:
- Throttle active events with summaries

## 4.1.15 - 2026-01-13T22:12:07.268Z
Previous: 4.1.14
Commit: 22050bb
Changes:
- Mirror global errors into console log stream

## 4.1.14 - 2026-01-13T19:23:14.135Z
Previous: 4.1.13
Commit: d4144e5
Changes:
- Capture console info/debug and signals

## 4.1.13 - 2026-01-13T19:20:30.071Z
Previous: 4.1.12
Commit: c7dd009
Changes:
- Handle play-failure loops with probation

## 4.1.12 - 2026-01-13T18:51:19.113Z
Previous: 4.1.11
Commit: 56921fd
Changes:
- Add playback drift proxy logging

## 4.1.11 - 2026-01-13T18:00:53.362Z
Previous: 4.1.10
Commit: 1bbab13
Changes:
- Defer catch-up to live edge after stable recovery

## 4.1.10 - 2026-01-13T17:56:22.882Z
Previous: 4.1.9
Commit: b35ccb0
Changes:
- Bump version to 4.1.9

## 4.1.9 - 2026-01-13T16:36:44.545Z
Previous: 4.1.8
Commit: 075b541
Changes:
- No commits detected since last build

## 4.1.8 - 2026-01-13T16:36:31.397Z
Previous: 4.1.7
Commit: 075b541
Changes:
- Revert report legend changes

## 4.1.7 - 2026-01-13T16:35:18.566Z
Previous: 4.1.6
Commit: eb4dbc5
Changes:
- Refresh log legend icons
- Clarify report legend markers
- Add emergency heal points and probation rescan

## 4.1.6 - 2026-01-13T15:43:39.906Z
Previous: 4.1.5
Commit: cb20b12
Changes:
- Improve heal point selection and logging

## 4.1.5 - 2026-01-13T13:54:06.644Z
Previous: 4.1.4
Commit: 4a02c76
Changes:
- Summarize probe logging

## 4.1.4 - 2026-01-13T13:43:21.046Z
Previous: 4.1.3
Commit: f22513e
Changes:
- Throttle non-active event logging

## 4.1.3 - 2026-01-13T12:41:03.819Z
Previous: 4.1.2
Commit: c5e8fe8
Changes:
- Improve reset and candidate decision logs

## 4.1.2 - 2026-01-13T11:37:18.155Z
Previous: 4.1.1
Commit: 8e8cf89
Changes:
- Add reset grace and probation switching

## 4.1.1 - 2026-01-13T11:32:25.046Z
Previous: 4.1.0
Commit: ca57e00
Changes:
- Bump minor version to 4.1.0

## 4.1.0 - 2026-01-12T23:11:56.963Z
Previous: 4.0.58
Commit: f40377f
Changes:
- Document tuning and contribution basics

## 4.0.58 - 2026-01-12T23:09:58.884Z
Previous: 4.0.57
Commit: 9565ba8
Changes:
- Auto-update changelog on build

## 4.0.57 - 2026-01-12T23:02:49.050Z
Previous: 4.0.56
Commit: b29967d
Changes:
- Add tuning cheat sheet
- Centralize tuning config and split orchestration
- Log media state changes during watchdog
- Expire stale trust and broaden discovery readiness
- Treat ended videos as stalled candidates
- Centralize candidate trust rules
- Extract DOM video discovery
- Extract playhead attribution helper
- Use lightweight video state for candidate scoring
- Sync docs with monitor cap
