# Recovery Tests - Setup Instructions

## Files Created

✅ **package.json** - NPM configuration with build and test scripts
✅ **tests/test-runner.html** - HTML file that loads all source modules
✅ **tests/run-tests.js** - Puppeteer automation script
✅ **tests/recovery-tests.js** - Test suites (currently with placeholders + basic tests)

---

## Installation

Due to PowerShell execution policy, run npm install using cmd instead:

```bash
# Open Command Prompt (cmd.exe) in the project directory
cd "F:\Fynn\Projects\Tw Adb"

# Install dependencies
npm install
```

**Alternative**: Enable PowerShell scripts (run as Administrator):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then you can run:
```bash
npm install
```

---

## Usage

After installation:

```bash
# Run tests
npm test

# Run build (with automatic tests)
npm run build

# Run build without tests
npm run build --no-test

# Watch mode (auto-rerun tests on file changes)
npm run test:watch
```

---

## Current Test Status

The test file (`tests/recovery-tests.js`) currently includes:

✅ **Working tests**:
- Logger message capture
- Metrics counter increment
- StuckDetector paused state handling
- Integration test (Logger + Metrics)

⏳ **Placeholder tests** (will be implemented with refactored modules):
- RecoveryDiagnostics tests (module not yet created)
- PlayRetryHandler tests (module not yet refactored)

---

## Next Steps

1. ✅ Install dependencies (`npm install`)
2. ✅ Run tests to verify setup (`npm test`)
3. 🔄 Implement RecoveryDiagnostics.js and add real tests
4. 🔄 Refactor PlayRetryHandler.js and add real tests
5. 🔄 Continue with other module refactors

---

## Expected Output

After running `npm test`, you should see:

```
🧪 Starting automated test runner...
============================================================

📁 Loading test file: file:///F:/Fynn/Projects/Tw Adb/tests/test-runner.html

🧪 Running: RecoveryDiagnostics: Placeholder test
✅ PASS: RecoveryDiagnostics: Placeholder test

🧪 Running: Logger: Captures messages
  └─ [TEST] Test message | {"data":"test"}
✅ PASS: Logger: Captures messages

...

============================================================
📊 Test Summary: 6 passed, 0 failed
============================================================

⏱️  Duration: 1.23s
📊 Tests: 6 total
📝 Logger messages: 3

✅ All tests passed!
```

---

## Troubleshooting

**Issue**: `npm` command not found
- **Fix**: Install Node.js from https://nodejs.org/

**Issue**: PowerShell execution policy error
- **Fix**: Use cmd.exe instead of PowerShell, or enable scripts (see above)

**Issue**: Puppeteer download fails
- **Fix**: Set environment variable: `set PUPPETEER_SKIP_DOWNLOAD=true` and use system Chrome

---

## File Structure

```
Tw Adb/
├── tests/
│   ├── recovery-tests.js      # Test suites
│   ├── test-runner.html       # HTML test loader
│   └── run-tests.js           # Puppeteer automation
├── src/                       # Source modules (unchanged)
├── package.json               # NPM configuration (NEW)
└── node_modules/              # Dependencies (after npm install)
```
