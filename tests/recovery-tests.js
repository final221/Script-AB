import { Test, assert, assertEquals, MockManager } from './test-framework.js';

// Global MockManager instance
const mocks = new MockManager();

// Setup/Teardown
Test.beforeEach(() => {
    // Reset metrics before each test
    if (typeof Metrics !== 'undefined') {
        Metrics.reset();
    }
});

Test.afterEach(() => {
    // Restore all mocks
    mocks.restoreAll();

    // Clean up DOM elements created during tests
    const videos = document.querySelectorAll('video');
    videos.forEach(v => v.remove());
    const divs = document.querySelectorAll('div');
    divs.forEach(d => {
        if (d.id !== 'test-output') d.remove();
    });
});

// --- RecoveryDiagnostics Tests ---
(async () => {
    await Test.run('RecoveryDiagnostics: Detects detached video', () => {
        const detachedVideo = document.createElement('video');
        const result = RecoveryDiagnostics.diagnose(detachedVideo);

        assertEquals(result.canRecover, false, 'Should not be recoverable');
        assertEquals(result.suggestedStrategy, 'fatal', 'Should suggest fatal strategy');
        assert(result.blockers.includes('VIDEO_DETACHED'), 'Should detect VIDEO_DETACHED blocker');
    });

    await Test.run('RecoveryDiagnostics: Detects insufficient ready state', () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
        const result = RecoveryDiagnostics.diagnose(video);

        assertEquals(result.canRecover, true, 'Should be recoverable');
        assertEquals(result.suggestedStrategy, 'wait', 'Should suggest wait strategy');
        assert(result.blockers.includes('INSUFFICIENT_DATA'), 'Should detect INSUFFICIENT_DATA');
    });

    await Test.run('RecoveryDiagnostics: Healthy video state', () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        const result = RecoveryDiagnostics.diagnose(video);

        assertEquals(result.canRecover, true, 'Should be recoverable');
        assert(result.suggestedStrategy !== 'fatal', 'Should not be fatal');
    });

    // --- StuckDetector Tests ---

    await Test.run('StuckDetector: Ignores paused video', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        Object.defineProperty(video, 'ended', { value: false, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        if (typeof StuckDetector !== 'undefined') {
            StuckDetector.reset(video);
            const result = StuckDetector.check(video);
            assertEquals(result, null, 'Should not detect stuck when paused');
        } else {
            console.warn('StuckDetector not loaded - skipping');
        }
    });

    await Test.run('StuckDetector: Ignores buffering state', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'readyState', { value: 2, configurable: true }); // HAVE_CURRENT_DATA (Buffering)
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'ended', { value: false, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        StuckDetector.reset(video);

        // Multiple checks while buffering
        for (let i = 0; i < 5; i++) {
            const result = StuckDetector.check(video);
            assertEquals(result, null, 'Should not detect stuck while buffering');
        }
    });

    await Test.run('StuckDetector: Ignores seeking state', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'seeking', { value: true, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        StuckDetector.reset(video);

        const result = StuckDetector.check(video);
        assertEquals(result, null, 'Should not detect stuck while seeking');
    });

    // --- Logger Tests ---

    await Test.run('Logger: Captures messages', () => {
        const testMsg = `[TEST] Test message ${Date.now()}`;
        Logger.add(testMsg, { data: 'test' });

        const logs = Logger.getLogs();
        assert(logs.length > 0, 'Logger should capture messages');
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should contain test message');
    });

    // --- Metrics Tests ---

    await Test.run('Metrics: Increments counters', () => {
        Metrics.increment('errors');
        Metrics.increment('errors');

        assertEquals(Metrics.get('errors'), 2, 'Counter should be 2');
    });

    await Test.run('Metrics: Returns 0 for unknown keys', () => {
        assertEquals(Metrics.get('unknown_key'), 0, 'Unknown key should return 0');
    });

    // --- AdBlocker Tests ---

    await Test.run('AdBlocker: Correlation detects missed ads', async () => {
        if (AdBlocker.init) AdBlocker.init();

        const stats = AdBlocker.getCorrelationStats();
        assertEquals(typeof stats.lastAdDetectionTime, 'number', 'Should have lastAdDetectionTime');
        assertEquals(typeof stats.recoveryTriggersWithoutAds, 'number', 'Should have recoveryTriggersWithoutAds');
    });

    // --- Integration Test: Logger + Metrics ---

    await Test.run('Integration: Logger and Metrics work together', () => {
        const testMsg = `[INTEGRATION] Test log ${Date.now()}`;
        Logger.add(testMsg);
        Metrics.increment('errors');

        const logs = Logger.getLogs();
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should have messages');
        assertEquals(Metrics.get('errors'), 1, 'Metrics should be incremented');
    });

    // --- HealthMonitor Tests ---

    await Test.run('HealthMonitor: Cooldown prevents spam', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        HealthMonitor.start(container);

        // Mock StuckDetector
        mocks.mock(StuckDetector, 'check', () => ({ reason: 'test', details: {} }));

        // First trigger
        await Fn.sleep(1100);

        const triggersAfterFirst = Metrics.get('health_triggers');
        assert(triggersAfterFirst >= 1, 'Should trigger once');

        // Wait less than cooldown (5s)
        await Fn.sleep(2000);

        const triggersAfterShortWait = Metrics.get('health_triggers');
        assertEquals(triggersAfterShortWait, triggersAfterFirst, 'Should NOT trigger again during cooldown');

        HealthMonitor.stop();
    });

    await Test.run('HealthMonitor: Pause/Resume works', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        HealthMonitor.start(container);

        mocks.mock(StuckDetector, 'check', () => ({ reason: 'test', details: {} }));

        // Trigger once
        await Fn.sleep(1100);
        const initialTriggers = Metrics.get('health_triggers');
        assert(initialTriggers >= 1, 'Should trigger initially');

        // Pause
        HealthMonitor.pause();

        // Wait for cooldown to expire (5s) + interval
        await Fn.sleep(6000);

        const triggersWhilePaused = Metrics.get('health_triggers');
        assertEquals(triggersWhilePaused, initialTriggers, 'Should NOT trigger while paused');

        // Resume
        HealthMonitor.resume();
        await Fn.sleep(1100);

        const triggersAfterResume = Metrics.get('health_triggers');
        assert(triggersAfterResume > initialTriggers, 'Should trigger again after resume');

        HealthMonitor.stop();
    });

    // --- Logic.Player Tests ---

    await Test.run('Logic: Session tracking detects key changes', () => {
        Logic.Player.startSession();

        // First detection
        const obj1 = { ref: (x) => { } };
        Logic.Player.signatures[0].check(obj1, 'ref');

        const status1 = Logic.Player.getSessionStatus();
        assertEquals(status1.currentKeys.k0, 'ref', 'Should set k0 to ref');
        assertEquals(status1.totalChanges, 0, 'No changes yet');

        // Key change during session
        const obj2 = { foo: (x) => { } };
        Logic.Player.signatures[0].check(obj2, 'foo');

        const status2 = Logic.Player.getSessionStatus();
        assertEquals(status2.currentKeys.k0, 'foo', 'Should update k0 to foo');
        assertEquals(status2.totalChanges, 1, 'Should detect change');
        assertEquals(status2.recentChanges[0].oldKey, 'ref', 'Should track old key');
        assertEquals(status2.recentChanges[0].newKey, 'foo', 'Should track new key');

        Logic.Player.endSession();
    });

    await Test.run('Logic: Instability detection works', () => {
        Logic.Player.startSession();

        // Simulate 4 changes in quick succession
        const keys = ['ref', 'foo', 'bar', 'baz', 'qux'];
        keys.forEach(key => {
            const obj = { [key]: (x) => { } };
            Logic.Player.signatures[0].check(obj, key);
        });

        const isUnstable = Logic.Player.isSessionUnstable();
        assertEquals(isUnstable, true, 'Should detect instability after 4 changes');

        Logic.Player.endSession();
    });

    // --- PlayerContext Tests ---

    await Test.run('PlayerContext: Returns null for invalid element', () => {
        const result = PlayerContext.get(null);
        assertEquals(result, null, 'Should return null for null element');
    });

    await Test.run('PlayerContext: Handles detached element gracefully', () => {
        const element = document.createElement('div');
        element.__reactInternalInstance$test = {
            memoizedProps: { player: {} }
        };

        // It shouldn't crash
        const result = PlayerContext.get(element);
        assert(true, 'Should not throw error');
    });

    // --- ResilienceOrchestrator Tests ---

    await Test.run('ResilienceOrchestrator: Buffer validation forces aggressive', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        // Mock BufferAnalyzer
        mocks.mock(BufferAnalyzer, 'analyze', () => ({
            bufferHealth: 'critical',
            bufferSize: 1.5
        }));

        // Mock RecoveryDiagnostics
        mocks.mock(RecoveryDiagnostics, 'diagnose', () => ({ canRecover: true, suggestedStrategy: 'standard' }));

        // Mock RecoveryStrategy
        mocks.mock(RecoveryStrategy, 'select', () => ({ execute: async () => { } }));

        const payload = {};
        await ResilienceOrchestrator.execute(container, payload);

        assertEquals(payload.forceAggressive, true, 'Should force aggressive recovery due to low buffer');
    });

    await Test.run('ResilienceOrchestrator: Recovery validation detects failures', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        // Mock BufferAnalyzer
        mocks.mock(BufferAnalyzer, 'analyze', () => ({ bufferHealth: 'healthy', bufferSize: 10 }));

        // Mock RecoveryDiagnostics
        mocks.mock(RecoveryDiagnostics, 'diagnose', () => ({ canRecover: true, suggestedStrategy: 'standard' }));

        // Mock RecoveryStrategy
        mocks.mock(RecoveryStrategy, 'select', () => ({ execute: async () => { } }));

        // Pre-snapshot state
        Object.defineProperty(video, 'readyState', { value: 3, configurable: true });
        Object.defineProperty(video, 'error', { value: null, configurable: true });

        const payload = {};
        await ResilienceOrchestrator.execute(container, payload);

        assert(true, 'ResilienceOrchestrator executed without error');
    });

    await Test.run('FrameDropDetector: Ignores drops during normal playback', async () => {
        const video = document.createElement('video');

        // Mock: Video is playing with some frame drops (normal)
        Object.defineProperty(video, 'currentTime', {
            value: 10,
            configurable: true,
            writable: true
        });
        video.getVideoPlaybackQuality = () => ({
            droppedVideoFrames: 100,
            totalVideoFrames: 300
        });

        FrameDropDetector.reset();

        // First check - initializes state
        FrameDropDetector.check(video);

        // Simulate time passing and playback advancing
        await Fn.sleep(100);

        // Update mock to show advancement + more drops
        Object.defineProperty(video, 'currentTime', {
            value: 10.1, // Advanced 0.1s
            configurable: true,
            writable: true
        });
        video.getVideoPlaybackQuality = () => ({
            droppedVideoFrames: 650, // Massive drop (would trigger severe)
            totalVideoFrames: 330
        });

        // Override Date.now
        const realDateNow = Date.now;
        mocks.mock(Date, 'now', () => realDateNow() + 100);

        const result = FrameDropDetector.check(video);
        assertEquals(result, null, 'Should not trigger when video is progressing');
    });

    // Display summary
    Test.summary();
})();
