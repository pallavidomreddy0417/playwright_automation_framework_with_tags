/**
 * PlaywrightWebAutomation — custom runner (no Cucumber).
 *
 * Runs tests from tests/<all subfolders>/*.spec.js, filtered by tag expression.
 *
 * Examples:
 *   node runner.js
 *   node runner.js --tags "smoke"
 *   node runner.js --tags "smoke and login"
 *   node runner.js --file tests/login.spec.js
 *
 * Jenkins-style:
 *   node runner.js --env Staging --role Admin --browser chrome --tags "smoke"
 */

const path = require('node:path');
const fs = require('node:fs');
const { DriverFactory } = require('./src/factory/driverFactory');
const { loadConfig } = require('./src/config/config');
const { compileTagExpr } = require('./src/framework/tagExpr');
const { discoverTestFiles, loadTestsFromFile } = require('./src/framework/discoverTests');
const { ExtentReporter, safeFileName } = require('./src/reporting/extentReporter');
const {
  AllureReporter,
  isAllureEnabled,
  isAllureAutoGenerate,
  countAllureResultFiles,
  generateAllureHtml,
  createCompositeReporter
} = require('./src/reporting/allureReporter');
const { attachStepHelpers } = require('./src/framework/stepRunner');
const { beforeEach, afterEach } = require('./src/framework/testHooks');

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  // PowerShell can effectively pass an "empty" value in a way that ends up missing here.
  // If the flag is present but the value is missing (or the next token is another flag),
  // treat it as an empty string.
  if (next === undefined) return '';
  if (typeof next === 'string' && next.startsWith('--')) return '';
  return next;
}

// Allow "Jenkins-style" params via CLI too (in addition to env vars)
const env = getArgValue('--env') || getArgValue('--Environment');
const role = getArgValue('--role') || getArgValue('--Role');
const browser = getArgValue('--browser') || getArgValue('--Browser');
if (env) process.env.Environment = env;
if (role) process.env.Role = role;
if (browser) process.env.browser = browser;

// Always show browser by default (can override with HEADLESS=true)
process.env.HEADLESS = process.env.HEADLESS ?? 'false';
// Maximize by default when headed
process.env.MAXIMIZE = process.env.MAXIMIZE ?? 'true';

// Important: allow an empty tag expression ("") to mean "run all tests".
const tagsArg = getArgValue('--tags');
const tagsExpr = (tagsArg !== undefined) ? tagsArg : (process.env.TAGS ?? 'smoke');
const fileArgRaw = getArgValue('--file'); // optional single spec file (supports "path:line")
const testNameArg = getArgValue('--test'); // optional exact/substring match on test name

const cfg = loadConfig();
// Ensure the run uses the resolved values (properties file defaults unless Jenkins/CLI overrides).
process.env.Environment = cfg.environment;
process.env.Role = cfg.role;
process.env.browser = cfg.browser;

function normalizeFile(f) {
  return path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
}

function parseFileAndLine(raw) {
  if (!raw) return { file: null, line: null };
  const m = String(raw).match(/^(.*):(\d+)$/);
  if (!m) return { file: raw, line: null };
  return { file: m[1], line: Number(m[2]) };
}

function pickTestNameByLine(filePath, lineNumber) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  // Find "name: '...'" occurrences with their line numbers (1-based)
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    const mm = s.match(/\bname\s*:\s*(['"`])(.+?)\1/);
    if (mm) hits.push({ line: i + 1, name: mm[2] });
  }
  if (hits.length === 0) return null;
  // Choose the closest name defined at or above the requested line
  const candidates = hits.filter(h => h.line <= lineNumber);
  const chosen = (candidates.length ? candidates : hits).sort((a, b) => b.line - a.line)[0];
  return chosen?.name || null;
}

function now() {
  return new Date().toISOString();
}

function resetScreenshotsDir() {
  const ssDir = path.join(process.cwd(), 'reports', 'screenshots');
  // Keep each run clean so only current failures are present.
  fs.rmSync(ssDir, { recursive: true, force: true });
  fs.mkdirSync(ssDir, { recursive: true });
}

async function run() {
  const matcher = compileTagExpr(tagsExpr);
  const fileArg = parseFileAndLine(fileArgRaw);
  const testFiles = fileArg.file
    ? [normalizeFile(fileArg.file)]
    : discoverTestFiles(path.join(process.cwd(), 'tests'));

  const existingFiles = testFiles.filter(f => fs.existsSync(f));
  if (existingFiles.length === 0) {
    console.error(`No test files found. Looked in: ${fileArg ? fileArg : 'tests/**/*.spec.js'}`);
    process.exit(2);
  }

  const allTests = existingFiles.flatMap(loadTestsFromFile);
  let selected = allTests.filter(t => matcher(t.tags || []));

  // Optional: filter down to a single test by line in the file (path:line)
  if (fileArg.file && Number.isFinite(fileArg.line) && fileArg.line > 0) {
    const abs = normalizeFile(fileArg.file);
    const pickedName = pickTestNameByLine(abs, fileArg.line);
    if (!pickedName) {
      console.error(`Could not find a "name: '...'" near ${fileArg.file}:${fileArg.line}`);
      return 2;
    }
    selected = selected.filter(t => t.name === pickedName);
  }

  // Optional: filter by test name (exact/substring)
  if (testNameArg) {
    const q = String(testNameArg).toLowerCase();
    selected = selected.filter(t => String(t.name || '').toLowerCase().includes(q));
  }

  if (selected.length === 0) {
    console.log(`0 tests selected (tags: "${tagsExpr}")`);
    return 0;
  }

  resetScreenshotsDir();

  const extentReporter = new ExtentReporter({ outDir: 'reports' });
  const allureReporter = isAllureEnabled() ? new AllureReporter({ resultsDir: 'allure-results' }) : null;
  const reporter = createCompositeReporter(extentReporter, allureReporter);
  reporter.startRun({
    environment: cfg.environment,
    role: cfg.role,
    browser: cfg.browser,
    tags: tagsExpr
  });

  console.log(`[${now()}] Environment=${cfg.environment} Role=${cfg.role} browser=${cfg.browser} tags="${tagsExpr}"`);
  console.log(`Selected tests: ${selected.length}`);

  let failed = 0;

  for (const t of selected) {
    const name = t.name || 'Unnamed test';
    const tags = (t.tags || []).join(',');
    console.log(`\n--- RUN: ${name} [${tags}]`);

    const feature = path.basename(t.__file || 'tests');
    const testEntry = reporter.startTest({ feature, name, tags: (t.tags || []) });

    // world-like object for DriverFactory (keeps parallel-safe shape if you later parallelize)
    const world = {};
    await DriverFactory.initDriver(world, process.env.browser);
    // Provide config to hooks (auto-login needs it)
    world.config = cfg;

    let testError = null;
    let screenshotBuffer = null;
    let rel = null;

    try {
      const ctx = attachStepHelpers({
        reporter,
        testEntry,
        ctx: { page: world.page, context: world.context, browser: world.browser, config: cfg }
      });

      // Before hooks (applies to every test)
      await beforeEach({ test: t, world, reporter, testEntry });

      await t.run(ctx);
      console.log(`PASS: ${name}`);
    } catch (e) {
      failed++;
      testError = e;
      console.error(`FAIL: ${name}\n${e?.stack || e}`);
      try {
        screenshotBuffer = await world.page.screenshot();
        const outDir = path.join(process.cwd(), 'reports');
        const ssDir = path.join(outDir, 'screenshots');
        fs.mkdirSync(outDir, { recursive: true });
        fs.mkdirSync(ssDir, { recursive: true });
        const safe = safeFileName(name);
        rel = `screenshots/${safe}.png`;
        fs.writeFileSync(path.join(outDir, rel), screenshotBuffer);
        console.error(`Saved screenshot: reports/${rel}`);
      } catch (_) {}
    } finally {
      // After hooks run before Allure/Extent finalize so auto-logout steps are captured.
      try {
        await afterEach({
          test: t,
          world,
          reporter,
          testEntry,
          failed: testError != null
        });
      } catch (_) {
        // ignore
      }

      if (testError) {
        reporter.failTest(testEntry, testError, rel, screenshotBuffer);
      } else {
        reporter.passTest(testEntry);
      }

      await DriverFactory.closeDriver(world);
      // Similar to flushReport() in Java: keep report fresh after each scenario
      if (String(process.env.REPORT_FLUSH_EACH_TEST || 'true').toLowerCase() === 'true') {
        reporter.write();
      }
    }
  }

  // Capture suite end time for the sidebar
  reporter.endRun();
  reporter.write();
  console.log(`\nPlaywrightWebAutomation — Extent HTML report: reports/extent-report.html`);
  if (allureReporter) {
    const resultCount = countAllureResultFiles('allure-results');
    console.log(`PlaywrightWebAutomation — Allure raw results: allure-results/ (${resultCount} test(s))`);
    if (isAllureAutoGenerate()) {
      try {
        generateAllureHtml({ resultsDir: 'allure-results', reportDir: 'allure-report' });
        console.log(`PlaywrightWebAutomation — Allure HTML report: allure-report/ (${resultCount} test(s))`);
        console.log(`PlaywrightWebAutomation — Open in browser: npm run allure:open`);
      } catch (err) {
        console.error(`PlaywrightWebAutomation — Allure HTML generate failed: ${err?.message || err}`);
        console.log(`PlaywrightWebAutomation — Retry manually: npm run allure:generate`);
      }
    } else {
      console.log(`PlaywrightWebAutomation — Allure HTML skipped (Jenkins/CI uses allure-results/ for the plugin)`);
      console.log(`PlaywrightWebAutomation — Local HTML: npm run allure:generate && npm run allure:open`);
    }
  }
  // Create a zip archive of the reports directory as 'reports.zip'
  try {
    const archiver = require('archiver');
    const reportsDir = path.join(process.cwd(), 'reports');
    const zipPath = path.join(process.cwd(), 'reports.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`Created reports.zip (${archive.pointer()} total bytes)`);
        resolve();
      });
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      // Add ALL files/folders under reports/ (including screenshots) to the zip root.
      archive.directory(reportsDir, false);
      archive.finalize();
    });
  } catch (err) {
    console.error('Error creating reports.zip:', err);
  }
  return failed === 0 ? 0 : 1;
}

run()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(err?.stack || err);
    process.exit(1);
  });


