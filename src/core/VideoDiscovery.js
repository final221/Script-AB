// --- VideoDiscovery ---
/**
 * Scans the DOM for video elements and wires the mutation observer.
 */
const VideoDiscovery = (() => {
    const collectVideos = (targetNode) => {
        if (targetNode) {
            if (targetNode.nodeName === 'VIDEO') {
                return [targetNode];
            }
            if (targetNode.querySelectorAll) {
                return Array.from(targetNode.querySelectorAll('video'));
            }
            return [];
        }
        return Array.from(document.querySelectorAll('video'));
    };

    const notifyVideos = (videos, onVideo) => {
        if (!videos.length) {
            return;
        }
        Logger.add('[CORE] New video detected in DOM', {
            count: videos.length
        });
        Logger.add('[CORE] Video elements found, starting StreamHealer', {
            count: videos.length
        });
        videos.forEach(video => onVideo(video));
    };

    const start = (onVideo) => {
        if (!document?.querySelectorAll) {
            return null;
        }

        const scan = (targetNode = null) => {
            const videos = collectVideos(targetNode);
            notifyVideos(videos, onVideo);
        };

        scan();

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.nodeName === 'VIDEO'
                        || (node.querySelector && node.querySelector('video')))) {
                        scan(node);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        Logger.add('[CORE] DOM observer started');
        return observer;
    };

    return { start };
})();
