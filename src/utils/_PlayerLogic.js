// --- Player Logic Module ---
/**
 * Aggregates all player-related utilities.
 */
const _PlayerLogic = (() => {
    return {
        // SignatureValidator
        signatures: SignatureValidator.signatures,
        validate: SignatureValidator.validate,

        // SessionManager
        startSession: SessionManager.startSession,
        endSession: SessionManager.endSession,
        getSessionStatus: SessionManager.getSessionStatus,
        isSessionUnstable: SessionManager.isSessionUnstable,
        getSignatureStats: SessionManager.getSignatureStats
    };
})();
