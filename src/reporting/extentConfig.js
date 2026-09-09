const fs = require('node:fs');
const path = require('node:path');

function extractTag(xml, tag, fallback = '') {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(xml).match(re);
  return m ? m[1].trim() : fallback;
}

function loadExtentConfig() {
  const filePath = path.join(process.cwd(), 'reports', 'extentconfig.xml');
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      reportName: 'PlaywrightWebAutomation',
      reportHeadline: 'Web UI automation',
      theme: 'dark',
      documentTitle: 'PlaywrightWebAutomation',
      enableTimeline: true
    };
  }
  const xml = fs.readFileSync(filePath, 'utf8');
  const theme = extractTag(xml, 'theme', 'dark').toLowerCase();
  const enableTimelineRaw = extractTag(xml, 'enableTimeline', 'true').toLowerCase();

  return {
    filePath,
    reportName: extractTag(xml, 'reportName', 'PlaywrightWebAutomation'),
    reportHeadline: extractTag(xml, 'reportHeadline', 'Web UI automation'),
    theme: theme === 'standard' ? 'light' : theme,
    documentTitle: extractTag(xml, 'documentTitle', 'PlaywrightWebAutomation'),
    enableTimeline: enableTimelineRaw === 'true'
  };
}

module.exports = { loadExtentConfig };


