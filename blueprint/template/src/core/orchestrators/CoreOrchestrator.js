// @module CoreOrchestrator
// @depends Config, LogTags, LogTagRegistry
const CoreOrchestrator = (() => {
    const state = {
        startedAt: Date.now()
    };

    const getState = () => ({ ...state });

    return {
        getState
    };
})();
