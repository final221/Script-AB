import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ReportGenerator', () => {
    const originals = {};

    const stash = () => {
        originals.buildHeader = ReportTemplate.buildHeader;
        originals.render = TimelineRenderer.render;
        originals.createObjectURL = URL.createObjectURL;
        originals.revokeObjectURL = URL.revokeObjectURL;
    };

    const restore = () => {
        ReportTemplate.buildHeader = originals.buildHeader;
        TimelineRenderer.render = originals.render;
        URL.createObjectURL = originals.createObjectURL;
        URL.revokeObjectURL = originals.revokeObjectURL;
    };

    afterEach(() => {
        restore();
        vi.restoreAllMocks();
    });

    it('builds a report with header and timeline data', () => {
        stash();
        const headerSpy = vi.fn(() => 'HEADER\n');
        const renderSpy = vi.fn(() => 'TIMELINE\n');
        const createUrlSpy = vi.fn(() => 'blob:report');

        ReportTemplate.buildHeader = headerSpy;
        TimelineRenderer.render = renderSpy;
        URL.createObjectURL = createUrlSpy;
        URL.revokeObjectURL = vi.fn();

        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        const metricsSummary = { stalls: 1 };
        const logs = [{ source: 'SCRIPT', message: '[TEST]' }];
        const healerStats = { heals: 2 };

        ReportGenerator.exportReport(metricsSummary, logs, healerStats);

        expect(headerSpy).toHaveBeenCalledWith(metricsSummary, healerStats);
        expect(renderSpy).toHaveBeenCalledWith(logs);
        expect(createUrlSpy).toHaveBeenCalledTimes(1);

        clickSpy.mockRestore();
    });
});
