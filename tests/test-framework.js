/**
 * Test Framework
 * Provides test runner, assertions, and mock management.
 */

export const Test = {
    results: [],
    _beforeEach: [],
    _afterEach: [],

    beforeEach(fn) {
        this._beforeEach.push(fn);
    },

    afterEach(fn) {
        this._afterEach.push(fn);
    },

    async run(name, fn) {
        const result = { name, success: false, error: null, duration: 0 };
        const start = performance.now();

        console.log(`\n🧪 Running: ${name}`);

        try {
            for (const hook of this._beforeEach) {
                await hook();
            }
            await fn();
            result.success = true;
            console.log(`✅ PASS: ${name}`);
        } catch (e) {
            result.error = e;
            console.error(`❌ FAIL: ${name}`);
            console.error(e.message);
            if (e.details) console.error('Details:', e.details);
        } finally {
            // Run afterEach in reverse order
            for (let i = this._afterEach.length - 1; i >= 0; i--) {
                try {
                    await this._afterEach[i]();
                } catch (cleanupError) {
                    console.error('⚠️ Cleanup failed:', cleanupError);
                }
            }
            result.duration = performance.now() - start;
            this.results.push(result);
        }
    },

    summary() {
        const total = this.results.length;
        const passed = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        const duration = this.results.reduce((sum, r) => sum + r.duration, 0);

        console.log('\n' + '='.repeat(40));
        console.log('TEST SUMMARY');
        console.log('='.repeat(40));
        console.log(`Total:  ${total}`);
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);
        console.log(`Time:   ${duration.toFixed(2)}ms`);
        console.log('='.repeat(40));

        if (failed > 0) {
            console.log('\nFAILED TESTS:');
            this.results.filter(r => !r.success).forEach(r => {
                console.log(`- ${r.name}: ${r.error.message}`);
            });
        }

        // Signal completion for puppeteer
        window.__TEST_COMPLETE__ = true;
        window.__TEST_RESULTS__ = { total, passed, failed };
    }
};

export class MockManager {
    constructor() {
        this.mocks = [];
    }

    mock(obj, method, implementation) {
        if (!obj || typeof obj[method] === 'undefined') {
            throw new Error(`Cannot mock ${method} on object: method does not exist`);
        }

        const original = obj[method];
        this.mocks.push({ obj, method, original });
        obj[method] = implementation;
        return original;
    }

    restoreAll() {
        // Restore in reverse order
        for (let i = this.mocks.length - 1; i >= 0; i--) {
            const { obj, method, original } = this.mocks[i];
            obj[method] = original;
        }
        this.mocks = [];
    }
}

// Assertion Library
class AssertionError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'AssertionError';
        this.details = details;
    }
}

export const assert = (condition, message, details = {}) => {
    if (!condition) {
        throw new AssertionError(message, details);
    }
};

export const assertTrue = (condition, message) => assert(condition === true, message || 'Expected true', { actual: condition });
export const assertFalse = (condition, message) => assert(condition === false, message || 'Expected false', { actual: condition });

export const assertEquals = (actual, expected, message) => {
    if (actual !== expected) {
        if (typeof actual === 'object' && actual !== null && typeof expected === 'object' && expected !== null) {
            // Fallback to deep equals for objects if they are not strictly equal
            try {
                assertDeepEquals(actual, expected, message);
            } catch (e) {
                throw new AssertionError(message || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`, {
                    expected,
                    actual
                });
            }
        } else {
            throw new AssertionError(message || `Expected ${expected} but got ${actual}`, {
                expected,
                actual
            });
        }
    }
};

export const assertNotEquals = (actual, expected, message) => {
    if (actual === expected) {
        throw new AssertionError(message || `Expected ${actual} to not equal ${expected}`);
    }
};

export const assertDeepEquals = (actual, expected, message) => {
    const isObject = (obj) => obj !== null && typeof obj === 'object';

    if (!isObject(actual) || !isObject(expected)) {
        if (actual !== expected) {
            throw new AssertionError(message || `Expected ${actual} to equal ${expected}`, { expected, actual });
        }
        return;
    }

    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);

    if (actualKeys.length !== expectedKeys.length) {
        throw new AssertionError(message || `Expected ${expectedKeys.length} keys but got ${actualKeys.length}`, {
            expectedKeys,
            actualKeys
        });
    }

    for (const key of expectedKeys) {
        if (!actualKeys.includes(key)) {
            throw new AssertionError(message || `Missing key: ${key}`);
        }
        assertDeepEquals(actual[key], expected[key], `${message ? message + ': ' : ''}Mismatch at key ${key}`);
    }
};

export const assertReject = async (fn, message) => {
    try {
        await fn();
        throw new AssertionError(message || 'Expected async function to reject but it resolved');
    } catch (e) {
        if (e instanceof AssertionError) throw e;
        // Success: it rejected
    }
};

export const assertThrows = async (fn, message) => {
    try {
        await fn();
        throw new AssertionError(message || 'Expected function to throw but it did not');
    } catch (e) {
        if (e instanceof AssertionError) throw e;
        // Success: it threw
    }
};
