// --- HealPointFinder ---
/**
 * Finds heal points in buffered ranges.
 */
const HealPointFinder = (() => {
    const MIN_HEAL_BUFFER_S = CONFIG.recovery.MIN_HEAL_BUFFER_S;
    const MIN_HEAL_BUFFER_EMERGENCY_S = CONFIG.recovery.MIN_HEAL_BUFFER_EMERGENCY_S;
    const NUDGE_S = CONFIG.recovery.HEAL_NUDGE_S;
    const EDGE_GUARD_S = CONFIG.recovery.HEAL_EDGE_GUARD_S;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const getEmergencyStart = (range, currentTime) => {
        const rangeSize = range.end - range.start;
        if (rangeSize <= 0) {
            return range.start;
        }
        if (rangeSize <= EDGE_GUARD_S * 2) {
            return range.start + (rangeSize * 0.5);
        }
        const desired = Math.min(currentTime + NUDGE_S, range.end - EDGE_GUARD_S);
        return clamp(desired, range.start + EDGE_GUARD_S, range.end - EDGE_GUARD_S);
    };

    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add('[HEALER:ERROR] No video element');
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = BufferRanges.getBufferRanges(video);

        if (!options.silent) {
            Logger.add('[HEALER:SCAN] Scanning for heal point', {
                currentTime: currentTime.toFixed(3),
                bufferRanges: BufferRanges.formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        const candidates = [];
        const emergencyCandidates = [];

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const rangeSize = range.end - range.start;
            const effectiveStart = Math.max(range.start, currentTime);
            const contentAhead = range.end - effectiveStart;

            if (contentAhead <= MIN_HEAL_BUFFER_S) {
                if (rangeSize >= MIN_HEAL_BUFFER_EMERGENCY_S) {
                    const start = getEmergencyStart(range, currentTime);
                    emergencyCandidates.push({
                        start,
                        end: range.end,
                        gapSize: start - currentTime,
                        headroom: range.end - start,
                        inRange: currentTime >= range.start && currentTime <= range.end,
                        rangeIndex: i
                    });
                }
                continue;
            }

            let healStart = range.start + EDGE_GUARD_S;
            let isNudge = false;

            if (range.start <= currentTime && currentTime <= range.end) {
                healStart = currentTime + NUDGE_S;
                isNudge = true;
            }

            if (healStart >= range.end - EDGE_GUARD_S) {
                if (!options.silent) {
                    Logger.add('[HEALER:SKIP] Heal target too close to buffer end', {
                        healStart: healStart.toFixed(3),
                        rangeEnd: range.end.toFixed(3),
                        edgeGuard: EDGE_GUARD_S
                    });
                }
                continue;
            }

            const headroom = range.end - healStart;
            const gapSize = healStart - currentTime;
            candidates.push({
                start: healStart,
                end: range.end,
                gapSize,
                headroom,
                isNudge,
                rangeIndex: i
            });
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                if (a.isNudge !== b.isNudge) return a.isNudge ? -1 : 1;
                if (a.gapSize !== b.gapSize) return a.gapSize - b.gapSize;
                return b.headroom - a.headroom;
            });

            const healPoint = candidates[0];

            if (!options.silent) {
                Logger.add(healPoint.isNudge
                    ? '[HEALER:NUDGE] Contiguous buffer found'
                    : '[HEALER:FOUND] Heal point identified', {
                    healPoint: `${healPoint.start.toFixed(3)}-${healPoint.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    headroom: healPoint.headroom.toFixed(2) + 's',
                    edgeGuard: EDGE_GUARD_S
                });
            }

            return healPoint;
        }

        if (emergencyCandidates.length > 0) {
            emergencyCandidates.sort((a, b) => {
                if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
                const gapAbsA = Math.abs(a.gapSize);
                const gapAbsB = Math.abs(b.gapSize);
                if (gapAbsA !== gapAbsB) return gapAbsA - gapAbsB;
                return b.headroom - a.headroom;
            });

            const healPoint = emergencyCandidates[0];
            if (!options.silent) {
                Logger.add('[HEALER:EMERGENCY] Emergency heal point selected', {
                    healPoint: `${healPoint.start.toFixed(3)}-${healPoint.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    headroom: healPoint.headroom.toFixed(2) + 's',
                    inRange: healPoint.inRange,
                    minRequired: MIN_HEAL_BUFFER_EMERGENCY_S + 's',
                    edgeGuard: EDGE_GUARD_S
                });
            }

            return healPoint;
        }

        if (!options.silent) {
            Logger.add('[HEALER:NONE] No valid heal point found', {
                currentTime: currentTime.toFixed(3),
                ranges: BufferRanges.formatRanges(ranges),
                minRequired: MIN_HEAL_BUFFER_S + 's'
            });
        }

        return null;
    };

    return {
        findHealPoint,
        MIN_HEAL_BUFFER_S
    };
})();
