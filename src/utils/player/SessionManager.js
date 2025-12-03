// --- Session Manager ---
/**
 * Manages player session lifecycle and signature tracking.
 */
const SessionManager = (() => {
    // Session state
    let _sessionSignatures = {
        sessionId: null,
        mountTime: null,
        k0: null,
        k1: null,
        k2: null,
        keyHistory: []
    };

    /**
     * Starts a new player session
     */
    const startSession = () => {
        const sessionId = `session-${Date.now()}`;
        _sessionSignatures = {
            sessionId,
            mountTime: Date.now(),
            k0: null,
            k1: null,
            k2: null,
            keyHistory: []
        };

        // Update signature validators with new session
        SignatureValidator.setSession(_sessionSignatures);

        Logger.add('[Logic] New player session started', { sessionId });
    };

    /**
     * Ends the current session
     */
    const endSession = () => {
        const session = _sessionSignatures;
        if (!session.sessionId) return;

        Logger.add('[Logic] Player session ended', {
            sessionId: session.sessionId,
            duration: Date.now() - session.mountTime,
            finalKeys: {
                k0: session.k0,
                k1: session.k1,
                k2: session.k2
            },
            keyChanges: session.keyHistory.length
        });

        if (session.keyHistory.length > 0) {
            Logger.add('[Logic] ⚠️ ALERT: Signature keys changed during session', {
                sessionId: session.sessionId,
                changes: session.keyHistory
            });
        }

        // Clear session reference
        SignatureValidator.setSession(null);
    };

    /**
     * Gets current session status
     * @returns {Object} Session status
     */
    const getSessionStatus = () => {
        const session = _sessionSignatures;
        return {
            sessionId: session.sessionId,
            uptime: session.mountTime ? Date.now() - session.mountTime : 0,
            currentKeys: {
                k0: session.k0,
                k1: session.k1,
                k2: session.k2
            },
            totalChanges: session.keyHistory.length,
            recentChanges: session.keyHistory.slice(-5),
            allKeysSet: !!(session.k0 && session.k1 && session.k2)
        };
    };

    /**
     * Checks if session is unstable (too many key changes)
     * @returns {boolean} True if unstable
     */
    const isSessionUnstable = () => {
        const session = _sessionSignatures;

        const hourAgo = Date.now() - 3600000;
        const recentChanges = session.keyHistory.filter(c => c.timestamp > hourAgo);

        const isUnstable = recentChanges.length > 3;

        if (isUnstable) {
            Logger.add('[Logic] ⚠️ ALERT: Signature session UNSTABLE', {
                changesInLastHour: recentChanges.length,
                threshold: 3,
                suggestion: 'Twitch may have updated player - patterns may break soon'
            });
        }

        return isUnstable;
    };

    /**
     * Gets signature stats (alias for backward compatibility)
     * @returns {Object} Session status
     */
    const getSignatureStats = () => getSessionStatus();

    return {
        startSession,
        endSession,
        getSessionStatus,
        isSessionUnstable,
        getSignatureStats
    };
})();
