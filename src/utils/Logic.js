// ============================================================================
// 4. LOGIC KERNELS
// ============================================================================
/**
 * Pure business logic for Network analysis and Player signature matching.
 * @namespace Logic
 */
const Logic = {
    Network: {
        isAd: (url) => CONFIG.regex.AD_BLOCK.test(url),
        isTrigger: (url) => CONFIG.regex.AD_TRIGGER.test(url),
        getMock: (url) => {
            if (url.includes('.m3u8')) {
                return { body: CONFIG.mock.M3U8, type: 'application/vnd.apple.mpegurl' };
            }
            if (url.includes('vast') || url.includes('xml')) {
                return { body: CONFIG.mock.VAST, type: 'application/xml' };
            }
            return { body: CONFIG.mock.JSON, type: 'application/json' };
        }
    },
    Player: {
        signatures: [
            {
                id: 'k0',
                check: (o, k) => {
                    try { return typeof o[k] === 'function' && o[k](true) === null; } catch (e) { return false; }
                }
            }, // Toggle/Mute
            {
                id: 'k1',
                check: (o, k) => {
                    try { return typeof o[k] === 'function' && o[k]() === null; } catch (e) { return false; }
                }
            }, // Pause
            {
                id: 'k2',
                check: (o, k) => {
                    try { return typeof o[k] === 'function' && o[k]() === null; } catch (e) { return false; }
                }
            }  // Other
        ],
        validate: (obj, key, sig) => Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)(),
    }
};
