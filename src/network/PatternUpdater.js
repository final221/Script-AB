// --- Pattern Updater ---
/**
 * Fetches and manages dynamic ad patterns from external sources.
 * Works ALONGSIDE existing static patterns - additive, not replacement.
 */
const PatternUpdater = (() => {
    // Community pattern sources (configurable)
    const PATTERN_SOURCES = [
        // Add your pattern source URLs here
        // 'https://raw.githubusercontent.com/<community>/twitch-patterns/main/patterns.json'
    ];

    const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // Refresh every 6 hours
    let lastUpdate = 0;
    let dynamicPatterns = [];
    let isInitialized = false;
    let fetchInProgress = false;

    /**
     * Fetches patterns from configured sources
     * @returns {Promise<boolean>} True if successful
     */
    const fetchPatterns = async () => {
        if (fetchInProgress) {
            Logger.add('[PatternUpdater] Fetch already in progress, skipping');
            return false;
        }

        if (PATTERN_SOURCES.length === 0) {
            Logger.add('[PatternUpdater] No pattern sources configured');
            return false;
        }

        fetchInProgress = true;
        Logger.add('[PatternUpdater] Fetching patterns...', {
            sourceCount: PATTERN_SOURCES.length,
            lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'never'
        });

        for (const source of PATTERN_SOURCES) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(source, {
                    cache: 'no-cache',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    Logger.add('[PatternUpdater] Source returned non-OK', {
                        source: source.substring(0, 50),
                        status: response.status
                    });
                    continue;
                }

                const data = await response.json();

                if (data.patterns && Array.isArray(data.patterns)) {
                    const oldCount = dynamicPatterns.length;
                    dynamicPatterns = data.patterns;
                    lastUpdate = Date.now();

                    Logger.add('[PatternUpdater] Patterns updated successfully', {
                        newCount: dynamicPatterns.length,
                        previousCount: oldCount,
                        version: data.version || 'unknown',
                        source: source.substring(0, 50)
                    });

                    fetchInProgress = false;
                    return true;
                } else {
                    Logger.add('[PatternUpdater] Invalid pattern format', {
                        source: source.substring(0, 50),
                        hasPatterns: !!data.patterns,
                        isArray: Array.isArray(data.patterns)
                    });
                }
            } catch (e) {
                Logger.add('[PatternUpdater] Fetch failed', {
                    source: source.substring(0, 50),
                    error: e.name,
                    message: e.message
                });
            }
        }

        Logger.add('[PatternUpdater] All sources failed or returned invalid data');
        fetchInProgress = false;
        return false;
    };

    /**
     * Checks if URL matches any dynamic pattern
     * @param {string} url - URL to check
     * @returns {boolean} True if matches
     */
    const matchesDynamic = (url) => {
        if (!url || dynamicPatterns.length === 0) return false;

        for (const pattern of dynamicPatterns) {
            let matched = false;

            try {
                if (pattern.type === 'regex') {
                    matched = new RegExp(pattern.value, pattern.flags || 'i').test(url);
                } else {
                    // Default to string match
                    matched = url.includes(pattern.value);
                }
            } catch (e) {
                Logger.add('[PatternUpdater] Pattern match error', {
                    pattern: pattern.value,
                    error: e.message
                });
                continue;
            }

            if (matched) {
                Logger.add('[PatternUpdater] Dynamic pattern matched', {
                    url: url.substring(0, 100),
                    patternValue: pattern.value,
                    patternType: pattern.type || 'string'
                });
                return true;
            }
        }
        return false;
    };

    /**
     * Initialize - fetches patterns immediately on load
     */
    const init = () => {
        if (isInitialized) {
            Logger.add('[PatternUpdater] Already initialized');
            return;
        }
        isInitialized = true;

        Logger.add('[PatternUpdater] Initializing', {
            sourceCount: PATTERN_SOURCES.length,
            refreshIntervalHours: REFRESH_INTERVAL_MS / (60 * 60 * 1000)
        });

        // IMMEDIATE fetch on script load
        if (PATTERN_SOURCES.length > 0) {
            fetchPatterns();
        }

        // Periodic refresh check
        setInterval(() => {
            if (Date.now() - lastUpdate > REFRESH_INTERVAL_MS) {
                Logger.add('[PatternUpdater] Periodic refresh triggered');
                fetchPatterns();
            }
        }, 60000); // Check every minute if refresh needed
    };

    /**
     * Adds a pattern source URL
     * @param {string} url - Source URL to add
     */
    const addSource = (url) => {
        if (url && !PATTERN_SOURCES.includes(url)) {
            PATTERN_SOURCES.push(url);
            Logger.add('[PatternUpdater] Source added', { url: url.substring(0, 50) });
        }
    };

    return {
        init,
        matchesDynamic,
        addSource,
        forceUpdate: fetchPatterns,
        getPatterns: () => [...dynamicPatterns],
        getStats: () => ({
            patternCount: dynamicPatterns.length,
            lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'never',
            isInitialized,
            sourceCount: PATTERN_SOURCES.length
        })
    };
})();
