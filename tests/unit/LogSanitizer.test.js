import { describe, it, expect } from 'vitest';

describe('LogSanitizer', () => {
    it('orders detail keys using schemas and preserves extras', () => {
        const detail = { to: 'PLAYING', message: 'Changed', from: 'STALLED', extra: 1 };
        const sanitized = LogSanitizer.sanitizeDetail(detail, '[HEALER:STATE] State', new Set());
        expect(Object.keys(sanitized)).toEqual(['message', 'from', 'to', 'extra']);
    });

    it('splits message and JSON detail payload', () => {
        const split = LogSanitizer.splitDetail({ message: 'Hello', inlineMessage: 'Alt', value: 42 });
        expect(split.messageText).toBe('Hello');
        expect(split.jsonDetail).toBe(JSON.stringify({ value: 42 }));
    });
});
