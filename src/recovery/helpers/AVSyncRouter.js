// --- A/V Sync Router ---
/**
 * Routes A/V sync issues to specialized recovery.
 */
const AVSyncRouter = (() => {
    /**
     * Checks if the issue should be routed to A/V sync recovery.
     * @param {string} reason - The reason for recovery
     * @returns {boolean} True if it's an A/V sync issue
     */
    const shouldRouteToAVSync = (reason) => {
        return reason === CONFIG.events.AV_SYNC_ISSUE;
    };

    /**
     * Executes A/V sync recovery.
     * @returns {Promise<boolean>} True if recovery was successful
     */
    const executeAVSyncRecovery = async () => {
        Logger.add('[Resilience] Routing to AVSyncRecovery');
        return await AVSyncRecovery.fix();
    };

    return {
        shouldRouteToAVSync,
        executeAVSyncRecovery
    };
})();
