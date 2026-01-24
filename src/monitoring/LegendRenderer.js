// --- LegendRenderer ---
/**
 * Builds the legend section for report exports.
 */
const LegendRenderer = (() => {
    const buildLegend = () => {
        const tagLines = (typeof LogTagRegistry !== 'undefined' && LogTagRegistry?.getLegendLines)
            ? LogTagRegistry.getLegendLines()
            : [];
        const consoleLines = [
            '\uD83D\uDCCB = Console.log/info/debug',
            '\u26A0\uFE0F = Console.warn',
            '\u274C = Console.error'
        ];
        return [...tagLines, ...consoleLines].join('\n');
    };

    return { buildLegend };
})();
