/**
 * Manages recovery concurrency and timeouts.
 * Ensures only one recovery operation runs at a time.
 */
const RecoveryLock = (() => {
    let isFixing = false;
    let recoveryStartTime = 0;
    const RECOVERY_TIMEOUT_MS = 10000;

    return {
        /**
         * Attempts to acquire the recovery lock.
         * @returns {boolean} True if lock acquired, false if already locked.
         */
        acquire: () => {
            if (isFixing) {
                // Check for stale lock
                if (Date.now() - recoveryStartTime > RECOVERY_TIMEOUT_MS) {
                    Logger.add('[Resilience] Force-resetting stuck recovery lock');
                    isFixing = false;
                } else {
                    return false;
                }
            }

            isFixing = true;
            recoveryStartTime = Date.now();
            return true;
        },

        /**
         * Releases the recovery lock.
         */
        release: () => {
            isFixing = false;
            recoveryStartTime = 0;
        },

        /**
         * Checks if recovery is currently in progress.
         * @returns {boolean}
         */
        isLocked: () => isFixing
    };
})();
