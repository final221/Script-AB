const fs = require('fs').promises;
const path = require('path');

/**
 * File Scanner Module
 * Recursively scans directories for source files.
 */

/**
 * Recursively gets all files in a directory.
 * @param {string} dir - The directory to search.
 * @returns {Promise<string[]>} List of absolute file paths.
 */
const getFiles = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
        const res = path.resolve(dir, entry.name);
        return entry.isDirectory() ? getFiles(res) : res;
    }));
    return files.flat();
};

/**
 * Filters files based on criteria.
 * @param {string[]} allFiles - All discovered files
 * @param {string[]} priorityFiles - Files that should be loaded with priority
 * @param {string} entryFile - The entry point file
 * @param {string[]} excludes - Patterns to exclude
 * @returns {string[]} Filtered files
 */
const filterSourceFiles = (allFiles, priorityFiles, entryFile, excludes) => {
    const normalize = p => path.normalize(p);

    return allFiles.filter(file => {
        if (!file.endsWith('.js')) return false;
        if (excludes.some(ex => file.includes(ex))) return false;

        const isPriority = priorityFiles.some(p => normalize(p) === normalize(file));
        if (isPriority) return false;

        const isEntry = normalize(file) === normalize(entryFile);
        if (isEntry) return false;

        return true;
    });
};

module.exports = {
    getFiles,
    filterSourceFiles
};
