// @module ExternalAssetRecoveryFlow
// @depends ExternalAssetRecoveryProcess
const ExternalAssetRecoveryFlow = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const onRescan = options.onRescan || (() => {});

        const run = async ({ processId, signalLevel, signalMessage, activeBefore, helpers = {} }) => (
            ExternalAssetRecoveryProcess.run({
                processId,
                signalLevel,
                signalMessage,
                activeBefore,
                helpers,
                monitorsById,
                candidateSelector,
                recoveryManager,
                onRescan
            })
        );

        return { run };
    };

    return { create };
})();
