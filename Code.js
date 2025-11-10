// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core) - V3.59 PERFORM REVERSION ERROR LOGGING
// @version       3.59
// @description   🛡️ Stealth Reactor Core: Blocks Twitch ads with self-healing and remote configuration.
// @author        Senior Expert AI (Refactored)
// @match         *://*.twitch.tv/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function(){'use strict';

// --- Configuration Constants ---
const CONFIG_RAW = {
    security: {
        CORE_VERSION_MAJOR: 58,
        CORE_VERSION_MINOR: 15,
        CORE_XOR_SALT: 0x08,
    },
    selectors: {
        PLAYER_SELECTOR: '.video-player',
        VIDEO_ELEMENT_SELECTOR: 'video',
    },
    timing: {
        RETRY_DELAY_MS: 1000,
        INJECTION_DELAY_MS: 50,
        PLAYER_HEALTH_INTERVAL_MS: 2000,
        LOGGING_THROTTLE_LIMIT: 5,
        LOGGING_EXPIRY_MINUTES: 5,
        THROTTLE_REATTEMPT_DELAY_MINUTES: 15,
        REVERSION_DELAY_MS: 2,
        FORCE_PLAY_DEFER_MS: 1, // New constant for deferring forcePlay
        REATTEMPT_DELAY_MS: 15 * 60 * 1000, // 15 minutes in milliseconds
    },
    network: {
        AD_PATTERNS_DEFAULT: ['video-weaver.syd03.hls.ttvnw.net/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net'],
    },
    mockResponses: {
        EMPTY_UPLIST_M3U8: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n',
        NO_CONTENT_JSON: '{"data":[]}',
    },
    messaging: {
        // These will be derived after security constants are defined
    },
    playerControl: {
        MAX_RECURSIVE_DEPTH: 15,
        KEY_VERIFICATION_LIMIT: 5,
    },
    DEBUG_MODE: false,
};

// Derive dependent constants after initial definition
function initializeConfiguration(rawConfig) {
    rawConfig.security.CORE_KEY = (rawConfig.security.CORE_VERSION_MAJOR * rawConfig.security.CORE_VERSION_MINOR) ^ rawConfig.security.CORE_XOR_SALT;
    rawConfig.messaging.EVENT_NAMESPACE = `PHANTOM_CORE_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    rawConfig.messaging.ACTION_AD_DETECTED = `AD_EVT_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    rawConfig.messaging.ACTION_ACQUIRE_CORE = `ACQ_EVT_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    rawConfig.messaging.ACTION_CORE_REPORT = `REP_EVT_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    rawConfig.messaging.ACTION_LOG_EVENT = `LOG_EVT_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    rawConfig.messaging.ACTION_REACQUIRE_CORE = `REA_EVT_V${rawConfig.security.CORE_VERSION_MAJOR}_0`;
    return Object.freeze(rawConfig);
}

let CONFIG = initializeConfiguration(CONFIG_RAW);



// --- Utility Functions ---
const Utilities = {
    executionId: Math.random().toString(36).substring(2, 10),

    Logger: {
        log: (...args) => CONFIG.DEBUG_MODE && console.log(`[${CONFIG.messaging.EVENT_NAMESPACE}]`, ...args),
        warn: (...args) => CONFIG.DEBUG_MODE && console.warn(`[${CONFIG.messaging.EVENT_NAMESPACE}]`, ...args),
        error: (status, detail) => {
            if (CONFIG.DEBUG_MODE) {
                console.error(`[${CONFIG.messaging.EVENT_NAMESPACE}] CORE_ERROR: ${status} - ${detail}`);
            }
            Utilities.logCoreError(Utilities.executionId, CONFIG.messaging.ACTION_LOG_EVENT, status, detail);
        }
    },
    // Stage 3: Refactored to manage both error state and the reattempt timestamp
    getLogState: (defaultState) => {
        try {
            const stored = localStorage.getItem(CONFIG.messaging.EVENT_NAMESPACE);
            if (stored) {
                const logState = JSON.parse(stored);
                const isExpired = Date.now() - logState.timestamp > CONFIG.timing.LOGGING_EXPIRY_MINUTES * 60 * 1000;

                if (isExpired) return defaultState;

                return logState;
            }
        } catch (e) {
            if (CONFIG.DEBUG_MODE) Utilities.Logger.warn(`LocalStorage read error: ${e.message}`);
        }
        return defaultState;
    },
    setLogState: (logState) => {
        try {
            logState.timestamp = Date.now();
            localStorage.setItem(CONFIG.messaging.EVENT_NAMESPACE, JSON.stringify(logState));
        } catch (e) {
            if (CONFIG.DEBUG_MODE) Utilities.Logger.warn(`LocalStorage write error: ${e.message}`);
        }
    },
    logCoreError: (currentExecutionId, logEventAction, status, detail) => {
        if (CONFIG.DEBUG_MODE) {
            console.error(`[${CONFIG.messaging.EVENT_NAMESPACE}] CORE_ERROR: ${status} - ${detail}`);
        }
        const message = { type: currentExecutionId, action: logEventAction, status: status, detail: detail, time: Date.now() };
        window.postMessage(message, window.location.origin);
    },
    debounce: (func, delay) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    },
    createStateManager: (initialState) => {
        let state = initialState;
        return {
            get: (key) => state[key],
            set: (key, value) => { state[key] = value; }
        };
    },
    logState: () => {
        if (CONFIG.DEBUG_MODE) {
            Utilities.Logger.log("Current State:", State.get('adPatterns'), State.get('triggerPatterns'), State.get('logState'));
        }
    },
    setDebugMode: (enable) => {
        CONFIG_RAW.DEBUG_MODE = enable;
        CONFIG = initializeConfiguration(CONFIG_RAW); // Re-initialize CONFIG to reflect the change
        Utilities.Logger.log(`DEBUG_MODE set to: ${CONFIG.DEBUG_MODE}`);
    }
};

// --- State Management ---
const State = Utilities.createStateManager({
    adPatterns: new RegExp(CONFIG.network.AD_PATTERNS_DEFAULT.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
    triggerPatterns: new RegExp(CONFIG.network.AD_PATTERNS_DEFAULT.concat(['/ad_state/', 'vod_ad_manifest']).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
    intrinsicHooks: {
        originalXhrOpen: XMLHttpRequest.prototype.open,
        originalFetch: window.fetch,
    },
    isInitialAcquisition: true,
    healthCheckTimer: null,
    lifecycleRetryTimer: null, // New field for lifecycle retry timer
    videoSrcListener: null,
    // Stage 4: Telemetry state - Added lastAttemptTimestamp for self-healing
    logState: Utilities.getLogState({
        errorCount: 0,
        timestamp: 0,
        lastError: null,
        lastAttemptTimestamp: 0 // New field
    }),
});

// --- Pattern Matching & Configuration ---
const isNeutralizable = (url) => {
    return State.get('adPatterns').test(url);
};
const isTrigger = (url) => {
    return State.get('triggerPatterns').test(url);
};



// --- Network Hooking (Intrusion Layer) ---

function handleNetworkRequest(url) {
    if (isTrigger(url)) {
        window.postMessage({type: Utilities.executionId, action: CONFIG.messaging.ACTION_AD_DETECTED}, window.location.origin);
    }
    if (isNeutralizable(url)) {
        return true; // Indicate that the request should be neutralized
    }
    return false;
}

function hookIntrinsics() {
    // XHR Hooking remains robust
    XMLHttpRequest.prototype.open = new Proxy(State.get('intrinsicHooks').originalXhrOpen, {
        apply: function(target, thisArg, argumentsList) {
            const [method, url] = argumentsList;
            if (method === 'GET' && typeof url === 'string') {
                if (handleNetworkRequest(url)) {
                    const mock = url.includes('.m3u8') ? CONFIG.mockResponses.EMPTY_UPLIST_M3U8 : CONFIG.mockResponses.NO_CONTENT_JSON;
                    thisArg.addEventListener('readystatechange', function immediateInject() {
                        if (this.readyState === 2) {
                            Object.defineProperties(this, {
                                responseText: {value: mock, writable: false},
                                response: {value: mock, writable: false},
                                status: {value: 200, writable: false},
                                statusText: {value: 'OK', writable: false},
                            });
                            this.removeEventListener('readystatechange', immediateInject);
                        }
                    });
                    return;
                }
            }
            return Reflect.apply(target, thisArg, argumentsList);
        }
    });

    // Fetch Hooking remains robust
    window.fetch = new Proxy(State.get('intrinsicHooks').originalFetch, {
        apply: function(target, thisArg, argumentsList) {
            const [input] = argumentsList;
            const url = (typeof input === 'string') ? input : (input instanceof Request ? input.url : '');

            if (url) {
                if (handleNetworkRequest(url)) {
                    const body = url.includes('.m3u8') ? CONFIG.mockResponses.EMPTY_UPLIST_M3U8 : CONFIG.mockResponses.NO_CONTENT_JSON;
                    const contentType = url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/json';
                    const mockResponse = new Response(body, {status: 200, statusText: 'OK', headers: {'Content-Type': contentType}});
                    return Promise.resolve(mockResponse);
                }
            }
            return Reflect.apply(target, thisArg, argumentsList);
        }
    });
}

// --- Decentralized Reversion Logic (Host-Side Implementation) ---

const ReversionModule = {
    forceStop: (c, VS) => {
        const V = c.querySelector(VS);
        if (V) { V.src = ''; V.load(); }
    },
    forcePlay: (c, VS) => {
        const V = c.querySelector(VS);
        if (V) {
            const s = V.src;
            const b = '?t=' + Math.random().toString(36).substring(2, 10);
            V.src = '';
            V.load();
            // Use setTimeout to defer setting the new source and playing, allowing the browser
            // to process the previous src clear and load events, which can prevent issues
            // with video element state transitions.
            setTimeout(() => {
                V.src = s.split('?')[0] + b;
                V.load();
                V.play();
            }, CONFIG.timing.FORCE_PLAY_DEFER_MS);
        }
    },
    domReplace: (c) => {
        Utilities.Logger.warn('ReversionModule: Attempting DOM replacement as a fallback.');
        const n = c.cloneNode(true);
        if (c.parentNode) {
            c.parentNode.replaceChild(n, c);
            Utilities.Logger.log('ReversionModule: Successfully replaced DOM node.');
            return n;
        }
        Utilities.Logger.warn('ReversionModule: Parent node not found for DOM replacement. Returning original node.');
        return c;
    }
};

// --- Key Verification Logic ---
const createKeyVerifier = () => {
    const { MAX_RECURSIVE_DEPTH, KEY_VERIFICATION_LIMIT } = CONFIG.playerControl;

    let cachedPlayerContext = null;
    let keyMap = {k0: null, k1: null, k2: null};

    const signatureChecks = [
        {
            name: 'k0',
            type: 'function',
            validate: (obj, key) => {
                try {
                    const result = obj[key](true);
                    return result === undefined || result === null;
                } catch (e) {
                    Utilities.Logger.warn(`Key verification failed for k0 (true): ${e.message}`);
                    return false;
                }
            }
        },
        {
            name: 'k1',
            type: 'function',
            validate: (obj, key) => {
                try {
                    const result = obj[key]();
                    return result === undefined || result === null;
                } catch (e) {
                    Utilities.Logger.warn(`Key verification failed for k1 (): ${e.message}`);
                    return false;
                }
            }
        },
        {
            name: 'k2',
            type: 'function',
            validate: (obj, key) => {
                try {
                    const result = obj[key]();
                    return result === undefined || result === null;
                } catch (e) {
                    Utilities.Logger.warn(`Key verification failed for k2 (): ${e.message}`);
                    return false;
                }
            }
        }
    ];

    const verifyKey = (obj, keyIndex) => {
        const keyName = `k${keyIndex}`;
        const expectedSignature = signatureChecks[keyIndex];
        let currentKey = keyMap[keyName];

        // If a key is already cached and valid, return true
        if (currentKey && obj[currentKey] && typeof obj[currentKey] === expectedSignature.type &&
            expectedSignature.validate(obj, currentKey)) {
            return true;
        }

        // Search for the key if not cached or invalid
        for (const newKey in obj) {
            if (obj.hasOwnProperty(newKey)) {
                const value = obj[newKey];
                if (typeof value === expectedSignature.type) {
                    if (expectedSignature.validate(obj, newKey)) {
                        keyMap[keyName] = newKey;
                        return true; // Key found and validated, exit
                    }
                }
            }
        }
        return false; // Key not found or validated
    };

    const checkKeys = (o) => {
        for (let i = 0; i < signatureChecks.length; i++) {
            if (!keyMap[`k${i}`]) {
                verifyKey(o, i);
            }
        }
        if (keyMap.k0 && keyMap.k1 && keyMap.k2) {
            return o;
        }
        return null;
    };

    const recursiveContextSearch = (o, d = 0) => {
        if (d > MAX_RECURSIVE_DEPTH || !o || typeof o !== 'object') return null;
        try {
            const s = checkKeys(o);
            if (s) return s;
            for (const k in o) {
                const v = o[k];
                if (v && typeof v === 'object' && v !== o) {
                    const f = recursiveContextSearch(v, d + 1);
                    if (f) return f;
                }
            }
        } catch (e) {
            Utilities.Logger.warn(`recursiveContextSearch: Error during recursion for object key '${k}': ${e.message}`);
        }
        return null;
    };

    const getPlayerContextCached = (targetElement) => {
        if (cachedPlayerContext) return cachedPlayerContext;
        if (!targetElement) return null;
        for (const k in targetElement) {
            if (k.startsWith('__react') || k.startsWith('__vue') || k.startsWith('__next')) {
                const reactContext = recursiveContextSearch(targetElement[k], 0);
                if (reactContext) {
                    cachedPlayerContext = reactContext;
                    return reactContext;
                }
            }
        }
        return null;
    };

    const verifyAllKeys = (player, currentExecutionId, logEventAction) => {
        let failureDetails = [];
        let success = true;

        for (let i = 0; i < 3; i++) {
            const result = verifyKey(player, i);
            if (!result) { // Check for false directly
                failureDetails.push(`k${i}: Verification failed`); // More descriptive message
                success = false;
            }
        }

        if (!success) {
             Utilities.logCoreError(currentExecutionId, logEventAction, 'FAILED_KEY_VERIFICATION', `Details: ${failureDetails.join('; ')}`);
             cachedPlayerContext = null;
             keyMap = {k0: null, k1: null, k2: null};
             window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_CORE_REPORT, status: 'FAILED_KEY_VERIFICATION'}, window.location.origin);
             return false;
        }
        return true;
    };

    return {
        getPlayerContextCached,
        verifyAllKeys,
        getKeyMap: () => keyMap, // Provide a getter for keyMap if needed externally
        resetCache: () => { cachedPlayerContext = null; },
        resetKeyMap: () => { keyMap = {k0: null, k1: null, k2: null}; }
    };
};

// --- Temporal Core Definition (Function Injection) ---

// --- Key Verification Logic ---


const keyVerifier = createKeyVerifier();

const ReversionHandler = (() => {
        const _performReversion = (player, container, forceStop, forcePlay, videoElementSelector, keyMap, currentExecutionId, coreReportAction, logEventAction) => {
            try {
                forceStop(container, videoElementSelector);
                setTimeout(() => {
                    player[keyMap.k1]();
                    player[keyMap.k0](true);
                    ReversionModule.forcePlay(container, CONFIG.selectors.VIDEO_ELEMENT_SELECTOR);
                    window.postMessage({type: currentExecutionId, action: coreReportAction, status: 'SUCCESS_TPL_REVERT'}, window.location.origin);
                }, CONFIG.timing.REVERSION_DELAY_MS);
            } catch (e) {
                Utilities.Logger.error('PERFORM_REVERSION_ERROR', e.message);
                _handleReversionError(e, container, forceStop, ReversionModule.domReplace, videoElementSelector, currentExecutionId, coreReportAction, logEventAction);
            }
        };
    const _handleReversionError = (e, container, forceStop, domReplace, videoElementSelector, currentExecutionId, coreReportAction, logEventAction) => {
        try {
            // DOM replacement fallback
            const newContainer = domReplace(container);
            // Invalidate cache after DOM replacement
            keyVerifier.resetCache();
            keyVerifier.resetKeyMap();
            let tempPlayerContext = keyVerifier.getPlayerContextCached(newContainer);
            if (!tempPlayerContext) {
                Utilities.logCoreError(currentExecutionId, logEventAction, 'DOM_REACQUIRE_FAILED', 'Failed to reacquire player context after DOM replacement.');
                window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_CORE_REPORT, status: 'FAILED_EXECUTION'}, window.location.origin);
                return;
            };
            forceStop(newContainer, videoElementSelector);
            setTimeout(() => { newContainer.querySelector(videoElementSelector).play(); }, CONFIG.timing.REVERSION_DELAY_MS);
            window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_CORE_REPORT, status: 'DOM_REVERT_SUCCESS'}, window.location.origin);
        } catch (e2) {
            Utilities.logCoreError(currentExecutionId, logEventAction, 'FAILED_EXECUTION', e2.message);
            keyVerifier.resetCache();
            keyVerifier.resetKeyMap();
            window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_CORE_REPORT, status: 'FAILED_EXECUTION'}, window.location.origin);
        }
    };

    const _revertStream = (player, container, currentExecutionId, logEventAction) => {
        if (!keyVerifier.verifyAllKeys(player, currentExecutionId, logEventAction)) {
            return;
        }
        _performReversion(player, container, ReversionModule.forceStop, ReversionModule.forcePlay, CONFIG.selectors.VIDEO_ELEMENT_SELECTOR, keyVerifier.getKeyMap(), currentExecutionId, CONFIG.messaging.ACTION_CORE_REPORT, logEventAction);
    };

    return {
        revertStream: _revertStream
    };
})();




const HealthMonitor = (() => {
    let _healthCheckTimer = null;
    let _videoElement = null; // Store a reference to the video element

    const start = (playerSelector, videoElementSelector, currentExecutionId) => {
        const container = document.querySelector(playerSelector);
        if (!container) return;
        const video = container.querySelector(videoElementSelector);
        if (!video) return;

        // Always update _videoElement to the current video element
        if (_videoElement !== video) {
            if (_healthCheckTimer) {
                clearInterval(_healthCheckTimer);
                _healthCheckTimer = null;
                Utilities.Logger.log('HealthMonitor: Stopped monitoring previous video element.');
            }
            _videoElement = video;
            Utilities.Logger.log('HealthMonitor: New video element detected, updating reference.');
        }

        if (_healthCheckTimer) {
            // Timer is already running for this video element, no need to restart
            return;
        }

        Utilities.Logger.log('HealthMonitor: Starting to monitor video element.');
        _healthCheckTimer = setInterval(() => {
            // Re-check if the video element is still in the DOM, using the cached reference
            if (!document.body.contains(_videoElement)) {
                clearInterval(_healthCheckTimer);
                _healthCheckTimer = null;
                _videoElement = null; // Clear reference as it's no longer in DOM
                Utilities.Logger.log('HealthMonitor: Video element removed from DOM, stopping monitor.');
                return;
            }

            if (_videoElement.readyState < 4 && !_videoElement.paused && !_videoElement.ended) {
                clearInterval(_healthCheckTimer);
                _healthCheckTimer = null;
                Utilities.Logger.log('HealthMonitor: Ad detected or video stalled, triggering ad detection.');
                window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_AD_DETECTED}, '*');
            }
        }, CONFIG.timing.PLAYER_HEALTH_INTERVAL_MS);
    };

    return {
        start
    };
})();

const MessageProcessor = (() => {
    const _handleAcquireCore = (currentExecutionId) => {
        const container = document.querySelector(CONFIG.selectors.PLAYER_SELECTOR);
        if (container) {
            let tempPlayerContext = keyVerifier.getPlayerContextCached(container);
            window.postMessage({type: currentExecutionId, action: CONFIG.messaging.ACTION_CORE_REPORT, status: tempPlayerContext ? 'ACQUIRED' : 'FAILED_ACQUISITION'}, window.location.origin);
            if (tempPlayerContext) HealthMonitor.start(CONFIG.selectors.PLAYER_SELECTOR, CONFIG.selectors.VIDEO_ELEMENT_SELECTOR, currentExecutionId);
        }
    };

    const _handleReacquireCore = (onReacquireCore) => {
        onReacquireCore();
    };

    const _messageListener = (currentExecutionId, acquireCoreAction, logEventAction, _handleAdDetected, onReacquireCore) => (e) => {
        if (e.data?.type !== currentExecutionId || e.origin !== window.location.origin) {
             return;
        }

        const action = e.data?.action;

        switch (action) {
            case acquireCoreAction:
                _handleAcquireCore(currentExecutionId);
                break;
            case CONFIG.messaging.ACTION_REACQUIRE_CORE:
                _handleReacquireCore(onReacquireCore);
                break;
            case CONFIG.messaging.ACTION_AD_DETECTED:
                _handleAdDetected(currentExecutionId, logEventAction);
                break;
        }
    };

    const startListening = (config, currentExecutionId, _handleAdDetected, onReacquireCore) => {
        window.addEventListener('message', _messageListener(currentExecutionId, config.messaging.ACTION_ACQUIRE_CORE, config.messaging.ACTION_LOG_EVENT, _handleAdDetected, onReacquireCore));
    };

    const initialize = (config, currentExecutionId, _handleAdDetected, onReacquireCore) => {
        startListening(config, currentExecutionId, _handleAdDetected, onReacquireCore);
    };

    return {
        startListening,
        initialize
    };
})();

const temporalCoreLogic = (config, executionId) => {
    const currentExecutionId = executionId;

    const _handleAdDetected = (currentExecutionId, logEventAction) => {
        const container = document.querySelector(config.selectors.PLAYER_SELECTOR);
        if (!container) {
            Utilities.logCoreError(currentExecutionId, logEventAction, 'PLAYER_NOT_FOUND', 'Ad detected but player container not found.');
            return;
        }

        const player = keyVerifier.getPlayerContextCached(container);
        if (!player) {
            Utilities.logCoreError(currentExecutionId, logEventAction, 'PLAYER_CONTEXT_NOT_FOUND', 'Ad detected but player context not found.');
            return;
        }

        ReversionHandler.revertStream(player, container, currentExecutionId, logEventAction);
    };

    MessageProcessor.initialize(config, currentExecutionId, _handleAdDetected, injectExecutionCore);
};

// --- Injection and Lifecycle ---

let lifecycleObserverInstance = null; // Declare observer instance outside

function injectExecutionCore() {
    // Update last attempt timestamp before injection
    const currentLogState = State.get('logState');
    const newLogState = { ...currentLogState, lastAttemptTimestamp: Date.now() };
    State.set('logState', newLogState);
    Utilities.setLogState(newLogState);

    temporalCoreLogic(CONFIG, Utilities.executionId);
    window.postMessage({type: Utilities.executionId, action: CONFIG.messaging.ACTION_ACQUIRE_CORE}, window.location.origin);
}

function manageLifecycle() {
    const playerContainer = document.querySelector(CONFIG.selectors.PLAYER_SELECTOR);
    if (!playerContainer) {
        State.set('lifecycleRetryTimer', setTimeout(manageLifecycle, CONFIG.timing.RETRY_DELAY_MS));
        return;
    }
    if (State.get('lifecycleRetryTimer')) clearTimeout(State.get('lifecycleRetryTimer'));

    const lifecycleConfig = {childList: true, subtree: true, attributes: true, attributeFilter: ['class']};
    const debouncedAcquireCore = Utilities.debounce(() => {
        State.set('isInitialAcquisition', false);
        window.postMessage({type: Utilities.executionId, action: CONFIG.messaging.ACTION_ACQUIRE_CORE}, window.location.origin);
    }, CONFIG.timing.INJECTION_DELAY_MS * 2); // Debounce for twice the injection delay

    const determineReacquisitionNeeded = (mutationsList) => {
        let needed = State.get('isInitialAcquisition'); // Always reacquire on initial load

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                const videoAdded = Array.from(mutation.addedNodes).some(node => node.matches && node.matches(CONFIG.VIDEO_ELEMENT_SELECTOR));
                const videoRemoved = Array.from(mutation.removedNodes).some(node => node.matches && node.matches(CONFIG.VIDEO_ELEMENT_SELECTOR));
                if (videoAdded || videoRemoved) {
                    needed = true;
                }
            }

            const target = mutation.target;
            const isPlayerStateChange = (target.closest(CONFIG.selectors.PLAYER_SELECTOR) && mutation.attributeName === 'class');
            const isElementRemoval = (mutation.removedNodes.length > 0 && Array.from(mutation.removedNodes).some(n => n.closest(CONFIG.selectors.PLAYER_SELECTOR)));

            if (isPlayerStateChange || isElementRemoval) {
                needed = true;
            }
        }
        return needed;
    };

    const lifecycleCallback = (mutationsList, observer) => {
        if (determineReacquisitionNeeded(mutationsList)) {
            debouncedAcquireCore();
        }
    };

    if (!lifecycleObserverInstance) {
        lifecycleObserverInstance = new MutationObserver(lifecycleCallback);
    } else {
        lifecycleObserverInstance.disconnect(); // Disconnect existing observer before re-observing
    }
    lifecycleObserverInstance.observe(playerContainer, lifecycleConfig);

    // Initial attachment of video listener
    attachVideoListener();
}

function attachVideoListener() {
    const playerContainer = document.querySelector(CONFIG.selectors.PLAYER_SELECTOR);
    if (!playerContainer) return;

    const videoElement = playerContainer.querySelector(CONFIG.selectors.VIDEO_ELEMENT_SELECTOR);
    if (!videoElement) return;

    const currentListener = State.get('videoSrcListener');

    // If a listener is already attached to the current video element, do nothing
    if (currentListener && currentListener.element === videoElement) {
        return;
    }

    // If a listener exists on a different element, remove it
    if (currentListener && currentListener.element !== videoElement) {
        currentListener.element.removeEventListener('loadstart', currentListener.handler);
        Utilities.Logger.log('VideoListener: Removed old listener from a different video element.');
    }

    const videoSrcChangeHandler = () => {
         window.postMessage({type: Utilities.executionId, action: CONFIG.messaging.ACTION_ACQUIRE_CORE}, window.location.origin);
    };

    videoElement.addEventListener('loadstart', videoSrcChangeHandler);
    State.set('videoSrcListener', { element: videoElement, handler: videoSrcChangeHandler });
    Utilities.Logger.log('VideoListener: Attached new listener to video element.');
}


function handleCoreResponse(event) {
    if (event.data?.type !== Utilities.executionId) return;

    if (event.data?.action === CONFIG.messaging.ACTION_LOG_EVENT) {
        const {status, detail} = event.data;
        const currentLogState = State.get('logState');
        const newLogState = {
            ...currentLogState,
            errorCount: currentLogState.errorCount + 1,
            lastError: `${status}: ${detail}`,
        };
        // Update lastAttemptTimestamp if not yet throttled. This ensures that the reattempt delay
        // is calculated from the last actual attempt before throttling engages, allowing for
        // a fresh reattempt window on subsequent page loads after the throttle period.
        if (newLogState.errorCount < CONFIG.timing.LOGGING_THROTTLE_LIMIT) {
            newLogState.lastAttemptTimestamp = Date.now();
        }
        State.set('logState', newLogState);
        Utilities.setLogState(newLogState);

        Utilities.Logger.error(status, detail);

        // If the error threshold is reached, reacquisition is disabled, but a re-attempt is scheduled on next page load.
        if (State.get('logState').errorCount >= CONFIG.timing.LOGGING_THROTTLE_LIMIT) {
             Utilities.Logger.error('CRITICAL_REACQUISITION_DISABLED', `Self-healing attempt scheduled for next page load after ${CONFIG.timing.THROTTLE_REATTEMPT_DELAY_MINUTES} minutes.`);
             return;
        }
    }

    if (event.data?.action === CONFIG.messaging.ACTION_CORE_REPORT) {
        const {status} = event.data;
        if (status.includes('FAILED') && State.get('logState').errorCount < CONFIG.timing.LOGGING_THROTTLE_LIMIT) {
            // Introduce a short delay before re-acquiring to prevent rapid looping
            setTimeout(() => {
                window.postMessage({type: Utilities.executionId, action: CONFIG.messaging.ACTION_ACQUIRE_CORE}, window.location.origin);
            }, CONFIG.timing.RETRY_DELAY_MS);
        }
    }
}

function startup() {
    State.set('logState', Utilities.getLogState({ errorCount: 0, timestamp: 0, lastError: null, lastAttemptTimestamp: 0 }));

    if (window.self !== window.top) {
        // Only run in the top-level frame
        return;
    }

    hookIntrinsics();
    window.addEventListener('message', handleCoreResponse);

    const isThrottled = State.get('logState').errorCount >= CONFIG.timing.LOGGING_THROTTLE_LIMIT;
    const timeSinceLastAttempt = Date.now() - State.get('logState').lastAttemptTimestamp;
    const canReattempt = timeSinceLastAttempt >= CONFIG.timing.REATTEMPT_DELAY_MS;

    if (isThrottled && !canReattempt) {
        Utilities.Logger.warn(`Self-Throttle engaged at startup. Skipping injection.`);
        return; // Exit early if throttled and reattempt not allowed
    }

    window.setTimeout(() => {
        injectExecutionCore();
        window.setTimeout(manageLifecycle, CONFIG.timing.INJECTION_DELAY_MS);
        Utilities.logState(); // Log state at startup if debug mode is on
    }, CONFIG.timing.INJECTION_DELAY_MS);
}

startup();
})();