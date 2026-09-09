const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function discoverTestFiles(rootDir) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) return [];
  return walk(absRoot).filter(f => f.endsWith('.spec.js'));
}

function loadTestsFromFile(filePath) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mod = require(filePath);
  const tests = Array.isArray(mod) ? mod : (mod?.default || []);
  if (!Array.isArray(tests)) return [];
  return tests.map(t => ({ ...t, __file: filePath }));
}

module.exports = { discoverTestFiles, loadTestsFromFile };


