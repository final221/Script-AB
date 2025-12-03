import { MockManager } from './test-framework.js';

/**
 * Shared Test Utilities
 * Common setup, teardown, and helpers for all test files.
 */

// Global MockManager instance
export const mocks = new MockManager();

/**
 * Standard setup function for tests
 */
export const setupTest = () => {
    // Reset metrics before each test
    if (typeof Metrics !== 'undefined') {
        Metrics.reset();
    }
};

/**
 * Standard teardown function for tests
 */
export const teardownTest = () => {
    // Restore all mocks
    mocks.restoreAll();

    // Clean up DOM elements created during tests
    const videos = document.querySelectorAll('video');
    videos.forEach(v => v.remove());
    const divs = document.querySelectorAll('div');
    divs.forEach(d => {
        if (d.id !== 'test-output') d.remove();
    });
};
