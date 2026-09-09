const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { Stage, Status, ContentType } = require('allure-js-commons');
const { ReporterRuntime, createDefaultWriter } = require('allure-js-commons/sdk/reporter');
const { MessageTestRuntime, setGlobalTestRuntime } = require('allure-js-commons/sdk/runtime');

class FrameworkTestRuntime extends MessageTestRuntime {
  constructor(forward) {
    super();
    this.forward = forward;
  }

  sendMessage(message) {
    this.forward(message);
  }
}

/**
 * Allure reporter for the custom PlaywrightWebAutomation runner (node runner.js).
 * Writes raw result files to allure-results/ for Jenkins Allure plugin / allure generate.
 */
class AllureReporter {
  constructor({ resultsDir = 'allure-results' } = {}) {
    this.resultsDir = path.join(process.cwd(), resultsDir);
    this.runtime = null;
    this.meta = {};
    this.currentForward = null;
  }

  #ensureRuntime() {
    if (this.runtime) return;
    fs.mkdirSync(this.resultsDir, { recursive: true });
    this.runtime = new ReporterRuntime({
      writer: createDefaultWriter({ resultsDir: this.resultsDir }),
      environmentInfo: {
        Environment: String(this.meta.environment || ''),
        Role: String(this.meta.role || ''),
        Browser: String(this.meta.browser || ''),
        Tags: String(this.meta.tags || '')
      }
    });

    setGlobalTestRuntime(
      new FrameworkTestRuntime((message) => {
        if (this.currentForward) {
          this.currentForward(message);
        }
      })
    );
  }

  startRun(meta) {
    this.meta = { ...meta };
    fs.rmSync(this.resultsDir, { recursive: true, force: true });
    this.runtime = null;
    this.#ensureRuntime();
  }

  endRun() {
    if (!this.runtime) return;
    this.runtime.writeEnvironmentInfo();
    this.runtime.writeCategoriesDefinitions();
  }

  startTest({ feature, name, tags }) {
    this.#ensureRuntime();

    const labels = [
      { name: 'feature', value: feature || 'Default' },
      { name: 'suite', value: feature || 'Default' },
      { name: 'parentSuite', value: 'PlaywrightWebAutomation Service Admin' },
      { name: 'framework', value: 'playwright-web-automation-custom-runner' },
      { name: 'language', value: 'javascript' }
    ];

    for (const tag of tags || []) {
      labels.push({ name: 'tag', value: String(tag) });
    }

    const uuid = this.runtime.startTest({
      name,
      fullName: `${feature || 'Default'} - ${name}`,
      stage: Stage.RUNNING,
      labels
    });

    this.currentForward = (message) => {
      this.runtime.applyRuntimeMessages(uuid, [message]);
    };

    return {
      id: uuid,
      allureUuid: uuid,
      feature: feature || 'Default',
      name,
      tags: tags || [],
      startedAt: new Date().toISOString(),
      startMs: Date.now(),
      status: 'RUNNING',
      steps: [],
      logs: [],
      error: null,
      screenshot: null,
      openSteps: new Map(),
      allureFinalized: false
    };
  }

  #isTestOpen(test) {
    return Boolean(this.runtime && test?.allureUuid && !test.allureFinalized);
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
    if (!this.#isTestOpen(test)) return;
    const stepUuid = this.runtime.startStep(test.allureUuid, null, {
      name: stepName,
      stage: Stage.RUNNING
    });
    if (!stepUuid) return;
    this.runtime.updateStep(stepUuid, (result) => {
      result.status = Status.PASSED;
      result.stage = Stage.FINISHED;
    });
    this.runtime.stopStep(stepUuid);
    test.steps.push({ name: stepName, status: 'PASS', ts: new Date().toISOString() });
  }

  logStepFail(test, stepName, error) {
    if (!this.#isTestOpen(test)) return;
    const errorText = error ? (error.stack || error.message || String(error)) : 'Unknown error';
    const stepUuid = this.runtime.startStep(test.allureUuid, null, {
      name: stepName,
      stage: Stage.RUNNING
    });
    if (!stepUuid) return;
    this.runtime.updateStep(stepUuid, (result) => {
      result.status = Status.FAILED;
      result.stage = Stage.FINISHED;
      result.statusDetails = {
        message: error?.message || String(error || 'Unknown error'),
        trace: errorText
      };
    });
    this.runtime.stopStep(stepUuid);
    test.steps.push({
      name: stepName,
      status: 'FAIL',
      ts: new Date().toISOString(),
      error: errorText
    });
    test.failedStep = stepName;
    test.failedStepError = errorText;
  }

  passTest(test) {
    if (!this.runtime || !test?.allureUuid || test.allureFinalized) return;
    test.status = 'PASS';
    test.endMs = Date.now();
    test.durationMs = test.endMs - test.startMs;
    test.endedAt = new Date().toISOString();

    this.runtime.updateTest(test.allureUuid, (result) => {
      result.status = Status.PASSED;
      result.stage = Stage.FINISHED;
    });
    this.runtime.stopTest(test.allureUuid);
    this.runtime.writeTest(test.allureUuid);
    test.allureFinalized = true;
    this.currentForward = null;
  }

  failTest(test, error, screenshotRelPath, screenshotBuffer) {
    if (!this.runtime || !test?.allureUuid || test.allureFinalized) return;
    test.status = 'FAIL';
    test.endMs = Date.now();
    test.durationMs = test.endMs - test.startMs;
    test.endedAt = new Date().toISOString();
    test.error = error ? (error.stack || error.message || String(error)) : 'Unknown error';
    test.screenshot = screenshotRelPath || null;

    if (screenshotBuffer && Buffer.isBuffer(screenshotBuffer)) {
      this.runtime.writeAttachment(
        test.allureUuid,
        null,
        'Failure screenshot',
        screenshotBuffer,
        { contentType: ContentType.PNG, fileExtension: 'png' }
      );
    }

    const errorText = test.error;
    this.runtime.writeAttachment(
      test.allureUuid,
      null,
      'Error trace',
      Buffer.from(errorText, 'utf8'),
      { contentType: ContentType.TEXT, fileExtension: 'txt' }
    );

    this.runtime.updateTest(test.allureUuid, (result) => {
      result.status = Status.FAILED;
      result.stage = Stage.FINISHED;
      result.statusDetails = {
        message: error?.message || String(error || 'Unknown error'),
        trace: errorText
      };
    });
    this.runtime.stopTest(test.allureUuid);
    this.runtime.writeTest(test.allureUuid);
    test.allureFinalized = true;
    this.currentForward = null;
  }

  write() {
    // Per-test results are flushed in passTest/failTest; nothing incremental to do here.
  }
}

function isAllureEnabled() {
  const raw = process.env.ALLURE;
  if (raw == null || raw === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

/** Build allure-report/ HTML from allure-results/ (local dev). Off on Jenkins unless forced. */
function isAllureAutoGenerate() {
  const raw = process.env.ALLURE_AUTO_GENERATE;
  if (raw != null && raw !== '') {
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
  }
  if (process.env.JENKINS_URL || process.env.CI === 'true' || process.env.CI === '1') {
    return false;
  }
  return true;
}

function countAllureResultFiles(resultsDir = 'allure-results') {
  const dir = path.join(process.cwd(), resultsDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('-result.json')).length;
}

function generateAllureHtml({ resultsDir = 'allure-results', reportDir = 'allure-report' } = {}) {
  const count = countAllureResultFiles(resultsDir);
  if (count === 0) {
    console.warn('[Allure] No *-result.json files in allure-results/ — skip HTML generate');
    return { count: 0, reportDir };
  }
  console.log(`[Allure] Generating HTML report for ${count} test(s)...`);
  execSync(`npx allure generate "${resultsDir}" --clean -o "${reportDir}"`, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env
  });
  return { count, reportDir };
}

function createCompositeReporter(extentReporter, allureReporter) {
  if (!allureReporter) return extentReporter;

  return {
    startRun(meta) {
      extentReporter.startRun(meta);
      allureReporter.startRun(meta);
    },
    endRun() {
      extentReporter.endRun();
      allureReporter.endRun();
    },
    startTest(opts) {
      const extentEntry = extentReporter.startTest(opts);
      const allureEntry = allureReporter.startTest(opts);
      return { extentEntry, allureEntry, ...extentEntry };
    },
    logInfo(testEntry, message) {
      extentReporter.logInfo(testEntry.extentEntry || testEntry, message);
      if (testEntry.allureEntry) allureReporter.logInfo(testEntry.allureEntry, message);
    },
    logWarn(testEntry, message) {
      extentReporter.logWarn(testEntry.extentEntry || testEntry, message);
      if (testEntry.allureEntry) allureReporter.logWarn(testEntry.allureEntry, message);
    },
    logError(testEntry, message) {
      extentReporter.logError(testEntry.extentEntry || testEntry, message);
      if (testEntry.allureEntry) allureReporter.logError(testEntry.allureEntry, message);
    },
    logStepPass(testEntry, stepName) {
      extentReporter.logStepPass(testEntry.extentEntry || testEntry, stepName);
      if (testEntry.allureEntry) allureReporter.logStepPass(testEntry.allureEntry, stepName);
    },
    logStepFail(testEntry, stepName, error) {
      extentReporter.logStepFail(testEntry.extentEntry || testEntry, stepName, error);
      if (testEntry.allureEntry) allureReporter.logStepFail(testEntry.allureEntry, stepName, error);
    },
    passTest(testEntry) {
      extentReporter.passTest(testEntry.extentEntry || testEntry);
      if (testEntry.allureEntry) allureReporter.passTest(testEntry.allureEntry);
    },
    failTest(testEntry, error, screenshotRelPath, screenshotBuffer) {
      extentReporter.failTest(testEntry.extentEntry || testEntry, error, screenshotRelPath, screenshotBuffer);
      if (testEntry.allureEntry) {
        allureReporter.failTest(
          testEntry.allureEntry,
          error,
          screenshotRelPath,
          screenshotBuffer
        );
      }
    },
    write() {
      extentReporter.write();
      allureReporter.write();
    }
  };
}

module.exports = {
  AllureReporter,
  isAllureEnabled,
  isAllureAutoGenerate,
  countAllureResultFiles,
  generateAllureHtml,
  createCompositeReporter
};
