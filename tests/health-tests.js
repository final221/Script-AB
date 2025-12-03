import { runStuckDetectorTests } from './health/stuck-detector-tests.js';
import { runHealthMonitorTests } from './health/health-monitor-tests.js';
import { runFrameDropTests } from './health/frame-drop-tests.js';

/**
 * Health Tests Orchestrator
 * Coordinates all health monitoring tests.
 */
export const runHealthTests = async () => {
    await runStuckDetectorTests();
    await runHealthMonitorTests();
    await runFrameDropTests();
};
