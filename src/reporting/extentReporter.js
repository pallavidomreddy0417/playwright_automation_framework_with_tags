const fs = require('node:fs');
const path = require('node:path');
const { loadExtentConfig } = require('./extentConfig');

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeFileName(input) {
  return String(input ?? '').replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

function formatIST(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(d);
}

class ExtentReporter {
  constructor({ outDir = 'reports' } = {}) {
    this.outDir = path.join(process.cwd(), outDir);
    this.cfg = loadExtentConfig();
    this.runStart = Date.now();
    this.tests = [];
  }

  startRun(meta) {
    this.meta = { ...meta, startedAt: new Date().toISOString() };
  }

  endRun() {
    if (!this.meta) this.meta = {};
    this.meta.endedAt = new Date().toISOString();
  }

  startTest({ feature, name, tags }) {
    const t = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      feature: feature || 'Default',
      name,
      tags: tags || [],
      startedAt: new Date().toISOString(),
      startMs: Date.now(),
      status: 'RUNNING',
      steps: [],
      logs: [],
      error: null,
      screenshot: null
    };
    this.tests.push(t);
    return t;
  }

  logInfo(test, message) {
    test.logs.push({ level: 'INFO', ts: new Date().toISOString(), message: String(message) });
  }

  logWarn(test, message) {
    test.logs.push({ level: 'WARN', ts: new Date().toISOString(), message: String(message) });
  }

  logError(test, message) {
    test.logs.push({ level: 'ERROR', ts: new Date().toISOString(), message: String(message) });
  }

  logStepPass(test, stepName) {
    test.steps.push({
      name: stepName,
      status: 'PASS',
      ts: new Date().toISOString()
    });
  }

  logStepFail(test, stepName, error) {
    const errorText = error ? (error.stack || error.message || String(error)) : 'Unknown error';
    test.steps.push({
      name: stepName,
      status: 'FAIL',
      ts: new Date().toISOString(),
      error: errorText
    });
    // Persist a direct pointer to the failing step for prominent HTML display.
    test.failedStep = stepName;
    test.failedStepError = errorText;
  }

  passTest(test) {
    test.status = 'PASS';
    test.endMs = Date.now();
    test.durationMs = test.endMs - test.startMs;
    test.endedAt = new Date().toISOString();
  }

  failTest(test, error, screenshotRelPath, screenshotBuffer) {
    test.status = 'FAIL';
    test.endMs = Date.now();
    test.durationMs = test.endMs - test.startMs;
    test.endedAt = new Date().toISOString();
    test.error = error ? (error.stack || error.message || String(error)) : 'Unknown error';
    test.screenshot = screenshotRelPath || null;

    if (screenshotBuffer && Buffer.isBuffer(screenshotBuffer)) {
      test.screenshotBase64 = screenshotBuffer.toString('base64');
    } else if (screenshotRelPath) {
      try {
        const fullPath = path.resolve(this.outDir, screenshotRelPath);
        if (fs.existsSync(fullPath)) {
          test.screenshotBase64 = fs.readFileSync(fullPath).toString('base64');
        }
      } catch (err) {
        console.error('Error reading screenshot file for base64 conversion:', err);
      }
    }
    if (!test.failedStep || !test.failedStepError) {
      const lastFailedStep = [...(test.steps || [])].reverse().find(s => s.status === 'FAIL');
      if (lastFailedStep) {
        test.failedStep = lastFailedStep.name;
        test.failedStepError = lastFailedStep.error || test.error;
      } else {
        // If failure happened outside ctx.step, add one synthetic fail step
        // so the error appears exactly once in the step timeline.
        test.failedStep = 'test execution';
        test.failedStepError = test.error;
        test.steps.push({
          name: test.failedStep,
          status: 'FAIL',
          ts: new Date().toISOString(),
          error: test.failedStepError
        });
      }
    }
  }

  write() {
    fs.mkdirSync(this.outDir, { recursive: true });

    const byFeature = new Map();
    for (const t of this.tests) {
      const key = t.feature || 'Default';
      const agg = byFeature.get(key) || { feature: key, total: 0, pass: 0, fail: 0 };
      agg.total++;
      if (t.status === 'PASS') agg.pass++;
      if (t.status === 'FAIL') agg.fail++;
      byFeature.set(key, agg);
    }

    const totals = { total: this.tests.length, pass: 0, fail: 0 };
    for (const t of this.tests) {
      if (t.status === 'PASS') totals.pass++;
      if (t.status === 'FAIL') totals.fail++;
    }
    const passPctNum = totals.total ? Number(((totals.pass / totals.total) * 100).toFixed(2)) : 0;
    const failPctNum = totals.total ? Number(((totals.fail / totals.total) * 100).toFixed(2)) : 0;

    const theme = (this.cfg.theme || 'dark').toLowerCase();
    const dark = theme === 'dark';
    const title = escapeHtml(this.cfg.documentTitle || 'PlaywrightWebAutomation');

    const featureRows = [...byFeature.values()]
      .sort((a, b) => a.feature.localeCompare(b.feature))
      .map(f => {
        const passPct = f.total ? ((f.pass / f.total) * 100).toFixed(2) : '0.00';
        const failPct = f.total ? ((f.fail / f.total) * 100).toFixed(2) : '0.00';
        return `<tr>
  <td>${escapeHtml(f.feature)}</td>
  <td>${f.total}</td>
  <td>${f.pass}</td>
  <td>${f.fail}</td>
  <td>${passPct}%</td>
  <td>${failPct}%</td>
</tr>`;
      })
      .join('\n');

    const testsHtml = this.tests
      .map(t => {
        const tagStr = t.tags.map(x => `<span class="tag">${escapeHtml(x)}</span>`).join(' ');
        const statusClass = t.status === 'PASS' ? 'pass' : (t.status === 'FAIL' ? 'fail' : 'run');
        let screenshotBase64 = t.screenshotBase64;
        if (!screenshotBase64 && t.screenshot) {
          try {
            const fullPath = path.resolve(this.outDir, t.screenshot);
            if (fs.existsSync(fullPath)) {
              screenshotBase64 = fs.readFileSync(fullPath).toString('base64');
            }
          } catch (err) {
            console.error('Error reading screenshot file for base64 conversion during write:', err);
          }
        }

        const ss = screenshotBase64
          ? `<div class="screenshot-preview-container" title="Click to view screenshot">
               <img class="screenshot-preview" src="data:image/png;base64,${screenshotBase64}" alt="Screenshot Preview" onclick="openScreenshotViewer(this.src)" />
             </div>`
          : '';

        // Render a single chronological feed so "scenario start" INFO appears before later PASS steps.
        const events = [];
        for (const l of (t.logs || [])) {
          const lvl = String(l.level || '').toUpperCase();
          const cls =
            lvl === 'ERROR' ? 'fail' :
            lvl === 'WARN' ? 'warn' :
            'info';
          events.push({
            kind: 'LOG',
            ts: l.ts,
            cls,
            badge: escapeHtml(l.level),
            name: escapeHtml(l.message),
            error: ''
          });
        }
        for (const s of (t.steps || [])) {
          const cls = s.status === 'PASS' ? 'pass' : 'fail';
          events.push({
            kind: 'STEP',
            ts: s.ts,
            cls,
            badge: escapeHtml(s.status),
            name: escapeHtml(s.name),
            error: s.error ? `<pre class="error">${escapeHtml(s.error)}</pre>` : ''
          });
        }

        events.sort((a, b) => {
          const at = Date.parse(a.ts || '') || 0;
          const bt = Date.parse(b.ts || '') || 0;
          if (at !== bt) return at - bt;
          // If same timestamp, prefer LOG lines first so "Starting scenario" stays above steps.
          if (a.kind !== b.kind) return a.kind === 'LOG' ? -1 : 1;
          return 0;
        });

        // Add a bit of space after the initial "scenario preamble" (contiguous LOGs at the top).
        let preambleCount = 0;
        while (preambleCount < events.length && events[preambleCount].kind === 'LOG') preambleCount++;

        const feed = events.length
          ? `<div class="steps">
  ${events.map((ev, idx) => {
    const preambleEndClass = (preambleCount > 0 && preambleCount < events.length && idx === preambleCount - 1)
      ? ' preamble-end'
      : '';
    return `<div class="step ${ev.cls}${preambleEndClass}">
  <div class="step-row">
    <span class="badge ${ev.cls}">${ev.badge}</span>
    <span class="step-name">${ev.name}</span>
    <span class="step-ts">${escapeHtml(formatIST(ev.ts))}</span>
  </div>
  ${ev.error || ''}
</div>`;
  }).join('\n')}
</div>`
          : '';

        const startIST = t.startedAt ? formatIST(t.startedAt) : '';
        const endIST = t.endedAt ? formatIST(t.endedAt) : '';

        return `<div class="test-item" data-feature="${escapeHtml(t.feature)}" data-status="${t.status}">
  <div class="test-head">
    <div>
      <div class="test-name">${escapeHtml(t.feature)} - ${escapeHtml(t.name)}</div>
      <div class="test-meta">${tagStr}</div>
    </div>
    <div class="test-right">
      <button class="toggle" type="button" data-toggle="details">Expand</button>
      <span class="badge ${statusClass}">${t.status}</span>
      <span class="dur">${t.durationMs ?? 0} ms</span>
      <span class="time">Start: ${escapeHtml(startIST)}</span>
      <span class="time">End: ${escapeHtml(endIST)}</span>
      ${ss}
    </div>
  </div>
  <div class="test-details" style="display:none;">
    ${feed}
  </div>
</div>`;
      })
      .join('\n');

    const timeline = this.cfg.enableTimeline
      ? `<h3>Timeline</h3>
<div class="timeline">
  ${this.tests.map(t => {
    const statusClass = t.status === 'PASS' ? 'pass' : (t.status === 'FAIL' ? 'fail' : 'run');
    return `<div class="tl-row">
  <div class="tl-name">${escapeHtml(t.name)}</div>
  <div class="tl-bar ${statusClass}" style="width:${Math.min(100, Math.max(3, (t.durationMs || 0) / 50))}%"></div>
  <div class="tl-dur">${t.durationMs ?? 0} ms</div>
</div>`;
  }).join('\n')}
</div>`
      : '';
    const dashboardStats = `<div class="dashboard-stats">
  <b>Total cases run:</b> ${totals.total}
  <span class="sep">|</span>
  <b>Pass:</b> ${totals.pass}
  <span class="sep">|</span>
  <b>Fail:</b> ${totals.fail}
</div>`;

    const dashboardPie = totals.total === 0
      ? `<div class="pie-wrap">
  <div class="pie empty"></div>
  <div class="pie-center">No tests</div>
  <div class="pie-legend">
    <div><span class="dot pass"></span>Pass: 0 (0.00%)</div>
    <div><span class="dot fail"></span>Fail: 0 (0.00%)</div>
  </div>
</div>`
      : (() => {
        const passAngle = (passPctNum * 360) / 100;
        const failAngle = (failPctNum * 360) / 100;
        const passMid = passAngle / 2;
        const failMid = passAngle + (failAngle / 2);
        const passSliceLabel = totals.pass > 0
          ? `<div class="slice-label pass" style="--a:${passMid}deg;">${totals.pass}</div>`
          : '';
        const failSliceLabel = totals.fail > 0
          ? `<div class="slice-label fail" style="--a:${failMid}deg;">${totals.fail}</div>`
          : '';
        return `<div class="pie-wrap">
  <div class="pie" style="--pass-pct:${passPctNum}; --fail-pct:${failPctNum};"></div>
  ${passSliceLabel}
  ${failSliceLabel}
  <div class="pie-center">${totals.total}</div>
  <div class="pie-legend">
    <div><span class="dot pass"></span>Pass: ${totals.pass} (${passPctNum.toFixed(2)}%)</div>
    <div><span class="dot fail"></span>Fail: ${totals.fail} (${failPctNum.toFixed(2)}%)</div>
  </div>
</div>`;
      })();

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --bg: ${dark ? '#0b1220' : '#ffffff'};
      --panel: ${dark ? '#121a2b' : '#f7f7f9'};
      --text: ${dark ? '#e7eefc' : '#111827'};
      --muted: ${dark ? '#a7b3cf' : '#4b5563'};
      --border: ${dark ? '#22304f' : '#e5e7eb'};
      --pass: #16a34a;
      --fail: #dc2626;
      --run: #2563eb;
      --info: #06b6d4;
      --warn: #f59e0b;
      --tag: ${dark ? '#1f2a44' : '#e5e7eb'};
    }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background: var(--bg); color: var(--text); }
    .app { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
    .sidebar { background: var(--panel); border-right: 1px solid var(--border); padding: 18px; position: sticky; top: 0; height: 100vh; box-sizing: border-box; }
    .brand { font-weight: 800; font-size: 16px; margin-bottom: 12px; }
    .nav { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
    .nav a { color: var(--text); text-decoration: none; padding: 10px 10px; border-radius: 8px; border: 1px solid transparent; }
    .nav a:hover { border-color: var(--border); }
    .nav a.active { background: rgba(37,99,235,.15); border-color: rgba(37,99,235,.35); }
    .meta { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .content { padding: 20px; }
    .wrap { max-width: 1100px; margin: 0 auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; }
    .title { font-size: 22px; font-weight: 700; margin:0; }
    .sub { color: var(--muted); margin-top: 6px; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-top: 14px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 8px; text-align: center; }
    th { color: var(--muted); font-weight: 700; }
    .test-item { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
    .test-head { display:flex; justify-content:space-between; gap: 12px; }
    .test-name { font-weight: 700; }
    .test-meta { margin-top: 6px; color: var(--muted); }
    .test-right { display:flex; align-items:center; gap: 10px; white-space: nowrap; }
    .toggle { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .toggle:hover { border-color: rgba(37,99,235,.5); }
    .badge { padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
    .badge.pass { background: rgba(22,163,74,.15); color: var(--pass); border: 1px solid rgba(22,163,74,.35); }
    .badge.fail { background: rgba(220,38,38,.15); color: var(--fail); border: 1px solid rgba(220,38,38,.35); }
    .badge.run { background: rgba(37,99,235,.15); color: var(--run); border: 1px solid rgba(37,99,235,.35); }
    .badge.info { background: rgba(6,182,212,.15); color: var(--info); border: 1px solid rgba(6,182,212,.35); }
    .badge.warn { background: rgba(245,158,11,.15); color: var(--warn); border: 1px solid rgba(245,158,11,.35); }
    .dur { color: var(--muted); font-size: 12px; }
    .time { color: var(--muted); font-size: 12px; }
    .tag { display:inline-block; padding:2px 8px; border-radius: 999px; background: var(--tag); margin-right: 6px; font-size: 12px; color: var(--text); }
    .link { color: ${dark ? '#93c5fd' : '#2563eb'}; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .screenshot-preview-container {
      display: inline-block;
      cursor: pointer;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      vertical-align: middle;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-left: 10px;
    }
    .screenshot-preview-container:hover {
      transform: scale(1.05);
      border-color: rgba(37,99,235,.5);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
    }
    .screenshot-preview {
      display: block;
      max-width: 80px;
      max-height: 45px;
      object-fit: cover;
    }
    .modal-viewer {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .modal-viewer-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(4px);
    }
    .modal-viewer-content {
      position: relative;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 90vw;
      height: 90vh;
      max-width: 1400px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5);
    }
    .modal-viewer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.1);
      user-select: none;
    }
    .modal-viewer-title {
      font-weight: 700;
      font-size: 15px;
      color: var(--text);
    }
    .modal-viewer-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .control-btn {
      background: var(--bg);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s;
      user-select: none;
    }
    .control-btn:hover {
      border-color: rgba(37,99,235,.5);
      background: rgba(37,99,235,.1);
    }
    .control-btn.close-btn {
      background: var(--fail);
      color: #ffffff;
      border-color: transparent;
      font-size: 18px;
      padding: 2px 10px;
    }
    .control-btn.close-btn:hover {
      background: #b91c1c;
    }
    .modal-viewer-body {
      flex: 1;
      overflow: auto;
      display: flex;
      background: #000000;
      position: relative;
    }
    #modalViewerImg {
      margin: auto;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
      box-shadow: 0 0 20px rgba(0,0,0,0.8);
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .error { background: rgba(220,38,38,.08); border: 1px solid rgba(220,38,38,.25); padding: 10px; border-radius: 8px; overflow:auto; }
    .steps { margin-top: 10px; border-top: 1px dashed var(--border); padding-top: 10px; }
    .step { padding: 8px; border: 1px solid var(--border); border-radius: 8px; margin-top: 8px; }
    .step.pass { border-color: rgba(22,163,74,.35); background: rgba(22,163,74,.06); }
    .step.fail { border-color: rgba(220,38,38,.35); background: rgba(220,38,38,.06); }
    .step.run { border-color: rgba(37,99,235,.35); background: rgba(37,99,235,.06); }
    .step.info { border-color: rgba(6,182,212,.35); background: rgba(6,182,212,.06); }
    .step.warn { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.06); }
    .step.preamble-end { margin-bottom: 12px; }
    .step-row { display:flex; align-items:center; gap: 10px; }
    .step-name { font-weight: 600; }
    .step-ts { margin-left:auto; color: var(--muted); font-size: 12px; }
    .filters { display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
    select { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; }
    .timeline .tl-row { display:flex; gap: 10px; align-items:center; margin: 6px 0; }
    .timeline .tl-name { width: 320px; overflow:hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
    .timeline .tl-bar { height: 8px; border-radius: 999px; background: var(--run); }
    .timeline .tl-bar.pass { background: var(--pass); }
    .timeline .tl-bar.fail { background: var(--fail); }
    .timeline .tl-dur { width: 90px; text-align:right; color: var(--muted); }
    .dash-grid { display:grid; grid-template-columns: 340px 1fr; gap: 14px; align-items:start; }
    .dashboard-stats { margin-bottom: 12px; color: var(--text); font-size: 14px; }
    .dashboard-stats .sep { color: var(--muted); margin: 0 10px; }
    .pie-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .pie {
      width: 180px;
      height: 180px;
      border-radius: 50%;
      background: conic-gradient(
        var(--pass) calc(var(--pass-pct, 0) * 1%),
        var(--fail) 0
      );
      border: 1px solid var(--border);
      position: relative;
    }
    .pie::after {
      content: '';
      position: absolute;
      inset: 34px;
      border-radius: 50%;
      background: var(--panel);
      border: 1px solid var(--border);
    }
    .pie.empty { background: conic-gradient(var(--border) 100%, var(--border) 0); }
    .pie-center {
      position: absolute;
      top: 69px;
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      pointer-events: none;
    }
    .slice-label {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%) rotate(var(--a)) translateY(-74px) rotate(calc(-1 * var(--a)));
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      line-height: 20px;
      text-align: center;
      color: #ffffff;
      border: 1px solid rgba(255,255,255,.28);
      background: rgba(10, 14, 23, .55);
      pointer-events: none;
    }
    .slice-label.pass { box-shadow: 0 0 0 1px rgba(22,163,74,.45) inset; }
    .slice-label.fail { box-shadow: 0 0 0 1px rgba(220,38,38,.45) inset; }
    .pie-legend { width: 100%; color: var(--muted); font-size: 13px; }
    .pie-legend > div { margin-top: 6px; display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
    .dot.pass { background: var(--pass); }
    .dot.fail { background: var(--fail); }
    @media (max-width: 980px) {
      .dash-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">${escapeHtml(this.cfg.reportName || 'PlaywrightWebAutomation')}</div>
      <div class="meta">
        <div>${escapeHtml(this.cfg.reportHeadline || '')}</div>
        <div>Started: ${escapeHtml(this.meta?.startedAt ? formatIST(this.meta.startedAt) : '')}</div>
        <div>Ended: ${escapeHtml(this.meta?.endedAt ? formatIST(this.meta.endedAt) : '')}</div>
        <div>Environment: ${escapeHtml(this.meta?.environment || '')}</div>
        <div>Role: ${escapeHtml(this.meta?.role || '')}</div>
        <div>Browser: ${escapeHtml(this.meta?.browser || '')}</div>
        <div>Tags: ${escapeHtml(this.meta?.tags || '')}</div>
      </div>
      <nav class="nav" id="sideNav">
        <a href="#dashboard" data-page="dashboard" class="active">Dashboard</a>
        <a href="#tests" data-page="tests">Tests</a>
        <a href="#timeline" data-page="timeline">Timeline</a>
      </nav>
    </aside>

    <main class="content">
      <div class="wrap">
        <div class="header">
          <div>
            <h1 class="title">${escapeHtml(this.cfg.documentTitle || 'PlaywrightWebAutomation')}</h1>
            <div class="sub">${escapeHtml(this.cfg.reportHeadline || '')}</div>
          </div>
        </div>

        <section id="page-dashboard" class="page">
          <div class="dash-grid">
            <div class="card">
              <h3>Execution Overview</h3>
              ${dashboardStats}
              ${dashboardPie}
            </div>
            <div class="card">
              <h3>Summary</h3>
              <table>
                <tr>
                  <th>Feature</th>
                  <th>Test Count</th>
                  <th>Pass</th>
                  <th>Fail</th>
                  <th>Pass %</th>
                  <th>Fail %</th>
                </tr>
                ${featureRows}
                <tr>
                  <td><b>Total</b></td>
                  <td><b>${totals.total}</b></td>
                  <td><b>${totals.pass}</b></td>
                  <td><b>${totals.fail}</b></td>
                  <td><b>${totals.total ? ((totals.pass / totals.total) * 100).toFixed(2) : '0.00'}%</b></td>
                  <td><b>${totals.total ? ((totals.fail / totals.total) * 100).toFixed(2) : '0.00'}%</b></td>
                </tr>
              </table>
            </div>
          </div>
        </section>

        <section id="page-tests" class="page" style="display:none;">
          <div class="card">
            <div class="header" style="margin-bottom:0;">
              <div><h3 style="margin:0;">Tests</h3></div>
              <div>
                <div class="filters">
                  <label>Feature</label>
                  <select id="featureSelect">
                    <option value="__all__">All</option>
                    ${[...byFeature.keys()].sort().map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')}
                  </select>
                  <label>Status</label>
                  <select id="statusSelect">
                    <option value="__all__">All</option>
                    <option value="PASS">PASS</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </div>
              </div>
            </div>
            ${testsHtml || '<div class="sub">No tests executed.</div>'}
          </div>
        </section>

        <section id="page-timeline" class="page" style="display:none;">
          <div class="card">
            ${timeline || '<div class="sub">Timeline disabled.</div>'}
          </div>
        </section>
      </div>
    </main>
  </div>

  <!-- Screenshot Viewer Modal -->
  <div id="screenshotModal" class="modal-viewer" style="display: none;">
    <div class="modal-viewer-overlay" onclick="closeScreenshotViewer()"></div>
    <div class="modal-viewer-content">
      <div class="modal-viewer-header">
        <span class="modal-viewer-title">Screenshot Viewer</span>
        <div class="modal-viewer-controls">
          <button onclick="zoomIn()" title="Zoom In (+)" class="control-btn">+</button>
          <button onclick="zoomOut()" title="Zoom Out (-)" class="control-btn">-</button>
          <button onclick="resetZoom()" title="Reset Zoom (100%)" class="control-btn">100%</button>
          <button onclick="closeScreenshotViewer()" title="Close (Esc)" class="control-btn close-btn">&times;</button>
        </div>
      </div>
      <div class="modal-viewer-body" id="modalViewerBody">
        <img id="modalViewerImg" src="" alt="Screenshot" />
      </div>
    </div>
  </div>

  <script>
    (function(){
      // Screenshot Viewer Logic
      let currentZoom = 1.0;
      let imgNaturalWidth = 0;
      let imgNaturalHeight = 0;
      let isDragging = false;
      let startX, startY, scrollLeft, scrollTop;

      const modal = document.getElementById('screenshotModal');
      const img = document.getElementById('modalViewerImg');
      const container = document.getElementById('modalViewerBody');

      window.openScreenshotViewer = function(src) {
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        
        img.src = src;
        modal.style.display = 'flex';
        
        img.onload = function() {
          imgNaturalWidth = img.naturalWidth;
          imgNaturalHeight = img.naturalHeight;
          
          const fitWidthScale = container.clientWidth / imgNaturalWidth;
          const fitHeightScale = container.clientHeight / imgNaturalHeight;
          currentZoom = Math.min(1.0, fitWidthScale, fitHeightScale);
          
          applyZoom(currentZoom);
        };
      };

      window.closeScreenshotViewer = function() {
        modal.style.display = 'none';
        img.src = '';
      };

      window.zoomIn = function() {
        applyZoom(currentZoom * 1.25);
      };

      window.zoomOut = function() {
        applyZoom(currentZoom / 1.25);
      };

      window.resetZoom = function() {
        applyZoom(1.0);
      };

      function applyZoom(newZoom) {
        if (!img || !imgNaturalWidth) return;
        newZoom = Math.max(0.05, Math.min(10.0, newZoom));

        const newWidth = imgNaturalWidth * newZoom;
        const newHeight = imgNaturalHeight * newZoom;

        const scrollCenterX = container.scrollLeft + container.clientWidth / 2;
        const scrollCenterY = container.scrollTop + container.clientHeight / 2;

        const widthRatio = img.clientWidth ? (newWidth / img.clientWidth) : 1;
        const heightRatio = img.clientHeight ? (newHeight / img.clientHeight) : 1;

        img.style.width = newWidth + 'px';
        img.style.height = newHeight + 'px';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';

        container.scrollLeft = scrollCenterX * widthRatio - container.clientWidth / 2;
        container.scrollTop = scrollCenterY * heightRatio - container.clientHeight / 2;

        currentZoom = newZoom;
        updateCursor();
      }

      function updateCursor() {
        if (container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight) {
          container.style.cursor = 'grab';
        } else {
          container.style.cursor = 'default';
        }
      }

      // Drag and scroll
      container.addEventListener('mousedown', (e) => {
        if (container.scrollWidth > container.clientWidth || container.scrollHeight > container.clientHeight) {
          isDragging = true;
          container.style.cursor = 'grabbing';
          startX = e.pageX - container.offsetLeft;
          startY = e.pageY - container.offsetTop;
          scrollLeft = container.scrollLeft;
          scrollTop = container.scrollTop;
        }
      });

      container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft - startX;
        const y = e.pageY - container.offsetTop - startY;
        container.scrollLeft = scrollLeft - x;
        container.scrollTop = scrollTop - y;
      });

      const stopDragging = () => {
        if (isDragging) {
          isDragging = false;
          updateCursor();
        }
      };

      container.addEventListener('mouseup', stopDragging);
      container.addEventListener('mouseleave', stopDragging);

      // Mouse wheel zoom
      container.addEventListener('wheel', function(e) {
        e.preventDefault();
        if (e.deltaY < 0) {
          applyZoom(currentZoom * 1.1);
        } else {
          applyZoom(currentZoom / 1.1);
        }
      }, { passive: false });

      // Esc key to close
      window.addEventListener('keydown', function(e) {
        if (modal && modal.style.display !== 'none' && e.key === 'Escape') {
          closeScreenshotViewer();
        }
      });

      // Sidebar navigation (single HTML, different "pages")
      const pages = {
        dashboard: document.getElementById('page-dashboard'),
        tests: document.getElementById('page-tests'),
        timeline: document.getElementById('page-timeline')
      };
      const links = Array.from(document.querySelectorAll('#sideNav a[data-page]'));

      function show(page){
        Object.entries(pages).forEach(([k, el]) => {
          if (!el) return;
          el.style.display = (k === page) ? '' : 'none';
        });
        links.forEach(a => a.classList.toggle('active', a.getAttribute('data-page') === page));
      }

      function pageFromHash(){
        const h = (location.hash || '#dashboard').replace('#','').toLowerCase();
        return pages[h] ? h : 'dashboard';
      }

      window.addEventListener('hashchange', () => show(pageFromHash()));
      show(pageFromHash());

      // Filters apply on Tests page
      const fSel = document.getElementById('featureSelect');
      const sSel = document.getElementById('statusSelect');
      function applyFilters(){
        if (!fSel || !sSel) return;
        const f = fSel.value;
        const s = sSel.value;
        document.querySelectorAll('.test-item').forEach(el => {
          const ef = el.getAttribute('data-feature');
          const es = el.getAttribute('data-status');
          const showF = (f === '__all__' || ef === f);
          const showS = (s === '__all__' || es === s);
          el.style.display = (showF && showS) ? '' : 'none';
        });
      }
      if (fSel) fSel.addEventListener('change', applyFilters);
      if (sSel) sSel.addEventListener('change', applyFilters);
      applyFilters();

      // Expand/Collapse per test item
      document.querySelectorAll('.test-item .toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = btn.closest('.test-item');
          if (!item) return;
          const details = item.querySelector('.test-details');
          if (!details) return;
          const open = details.style.display !== 'none';
          details.style.display = open ? 'none' : '';
          btn.textContent = open ? 'Expand' : 'Collapse';
        });
      });
    })();
  </script>
</body>
</html>`;

    fs.writeFileSync(path.join(this.outDir, 'extent-report.html'), html, 'utf8');
  }
}

module.exports = { ExtentReporter, safeFileName };


