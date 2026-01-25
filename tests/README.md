# Twitch Stream Healer Tests

This project uses **Vitest** with **JSDOM** for unit testing.

## Running Tests

- **Run all tests**: `npm test`
- **Watch mode**: `npm run test:watch`

## Structure

- `tests/unit/`: Contains unit tests for core modules.
- `tests/setup.js`: Global setup script that loads source files into the test environment.
- `vitest.config.js`: Configuration for Vitest.

## Writing Tests

Tests are written using the standard Vitest API (`describe`, `it`, `expect`).

Global modules (e.g., `Logger`, `StreamHealer`) are available on `window` or `global` (or directly as variables) because `tests/setup.js` loads them from `src/`.

Example:
```javascript
import { describe, it, expect } from 'vitest';

describe('MyModule', () => {
    it('does something', () => {
        const MyModule = window.MyModule;
        expect(MyModule.doSomething()).toBe(true);
    });
});
```
