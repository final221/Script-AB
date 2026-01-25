# Ownership Map

Use this to route changes quickly.

## Orchestrators
- src/core/orchestrators/CoreOrchestrator.js
- src/core/orchestrators/MonitoringOrchestrator.js
- src/core/orchestrators/RecoveryOrchestrator.js
- src/core/orchestrators/StreamHealer.js

## Playback monitoring
- src/core/playback/PlaybackMonitor.js
- src/core/playback/PlaybackWatchdog.js
- src/core/playback/PlaybackStateTracker.js
- src/core/playback/PlaybackEventHandlers.js

## Recovery and heal pipeline
- src/core/recovery/HealPipeline.js
- src/core/recovery/HealPointPoller.js
- src/core/recovery/RecoveryManager.js
- src/core/recovery/FailoverManager.js

## Candidate selection
- src/core/candidate/CandidateSelector.js
- src/core/candidate/CandidateScorer.js
- src/core/candidate/CandidateSwitchPolicy.js

## External signals
- src/core/external/ExternalSignalRouter.js
- src/core/external/ExternalSignalHandlerStall.js
- src/core/external/ExternalSignalHandlerAsset.js

## Logging and reporting
- src/monitoring/Logger.js
- src/monitoring/LogEvents.js
- src/monitoring/LogTagRegistry.js
- src/monitoring/ReportGenerator.js
