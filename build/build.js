const fs = require('fs');
const path = require('path');

const CONFIG = {
    BASE: path.join(__dirname, '..'),
    OUT: path.join(__dirname, '..', 'dist', 'code.js'),
    HEADER: path.join(__dirname, 'header.js'),
    VERSION: path.join(__dirname, 'version.txt'),
    PRIORITY: ['config/Config.js', 'utils/Utils.js', 'utils/Adapters.js', 'utils/Logic.js'],
    ENTRY: 'core/CoreOrchestrator.js'
};

const getFiles = (dir) => fs.readdirSync(dir).reduce((acc, file) => {
    const p = path.join(dir, file);
    return acc.concat(fs.statSync(p).isDirectory() ? getFiles(p) : p);
}, []);

const updateVersion = (type = 'patch') => {
    let ver = '1.0.0';
    try { ver = fs.readFileSync(CONFIG.VERSION, 'utf8').trim(); } catch (e) { }
    const parts = ver.split('.').map(Number);
    if (type === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
    else if (type === 'minor') { parts[1]++; parts[2] = 0; }
    else parts[2]++;
    const newVer = parts.join('.');
    fs.writeFileSync(CONFIG.VERSION, newVer);
    return { old: ver, new: newVer };
};

(() => {
    console.log('🏗️  Building...');
    const args = process.argv.slice(2);
    const vType = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch';
    const { old, new: ver } = updateVersion(vType);
    console.log(`📦 Version: ${old} → ${ver} (${vType})`);

    if (path.basename(CONFIG.OUT) === path.basename(__filename)) return console.error('❌ Output cannot be build script');

    const srcDir = path.join(CONFIG.BASE, 'src');
    const allFiles = getFiles(srcDir);
    const normalize = p => path.normalize(p);

    const priority = CONFIG.PRIORITY.map(f => path.join(srcDir, f));
    const entry = path.join(srcDir, CONFIG.ENTRY);
    const others = allFiles.filter(f => f.endsWith('.js') && !priority.some(p => normalize(p) === normalize(f)) && normalize(f) !== normalize(entry));

    const header = fs.existsSync(CONFIG.HEADER) ? fs.readFileSync(CONFIG.HEADER, 'utf8').replace('{{VERSION}}', ver) + '\n' : '';
    const content = [...priority, ...others, entry].map(f => {
        console.log(`   + ${path.relative(srcDir, f)}`);
        return fs.readFileSync(f, 'utf8');
    }).join('\n');

    try {
        fs.writeFileSync(CONFIG.OUT, `${header}(function () {\n    'use strict';\n\n${content}\n})();\n`);
        console.log(`✅ Built: ${CONFIG.OUT} (${(content.length / 1024).toFixed(2)} KB)`);
    } catch (e) { console.error(`❌ Error: ${e.message}`); }
})();
