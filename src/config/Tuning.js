// --- Tuning ---
/**
 * Derived thresholds and helper accessors for tuning logic.
 */
const Tuning = (() => {
    const stallConfirmMs = (bufferExhausted) => {
        const base = CONFIG.stall.STALL_CONFIRM_MS;
        if (bufferExhausted) return base;
        return base + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS;
    };

    const logIntervalMs = (isActive) => (
        isActive ? CONFIG.logging.ACTIVE_LOG_MS : CONFIG.logging.NON_ACTIVE_LOG_MS
    );

    return {
        stallConfirmMs,
        logIntervalMs
    };
})();
