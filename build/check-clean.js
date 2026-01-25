const { execSync } = require('child_process');

try {
    const status = execSync('git status --porcelain', {
        stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
    if (status) {
        console.error('[check-clean] Working tree is dirty after build.');
        process.exit(1);
    }
} catch (err) {
    console.error('[check-clean] Failed to check git status.');
    process.exit(1);
}
