/**
 * Runner-level Before/After hooks (applies to every test "scenario").
 *
 * Mirrors your old Java Hooks concept:
 * - Before order 1: log + create test entry already happens in runner
 * - Before order 2: browser setup (handled by runner via DriverFactory)
 * - Before order 3: clear cookies (skip if tag keepCookies)
 * - After: on failure attach last exception + screenshot (handled by runner)
 * - After: optional logout (skip if tag excludeFromAfterHook)
 * - AfterAll: final report flush (handled by runner)
 */

const { LoginPage } = require('../pages/loginPage');

function hasTag(tags, tag) {
  const set = new Set((tags || []).map(t => String(t).toLowerCase()));
  return set.has(String(tag).toLowerCase());
}

async function gotoWithRetry(page, url, retries = 3) {
  const waitModes = ['domcontentloaded', 'load', 'commit'];
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    const waitUntil = waitModes[Math.min(i, waitModes.length - 1)];
    try {
      await page.goto(url, { waitUntil, timeout: 90_000 });
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(1500 * (i + 1));
    }
  }
  throw lastErr;
}

async function beforeEach({ test, world, reporter, testEntry }) {
  const tags = test.tags || [];

  reporter.logInfo(testEntry, `Starting scenario: ${test.name}`);
  reporter.logInfo(testEntry, `Tags: ${(tags || []).join(', ')}`);

  // Clear cookies unless keepCookies tag is present
  if (!hasTag(tags, 'keepCookies')) {
    try {
      await world.context.clearCookies();
      reporter.logInfo(testEntry, 'Cleared all browser cookies before scenario');
    } catch (e) {
      reporter.logWarn(testEntry, `Failed to clear cookies: ${e?.message || e}`);
    }
  } else {
    reporter.logInfo(testEntry, 'Skipping cookie clear due to keepCookies tag');
  }

  // Auto-login for every test unless tagged noLogin
  if (!hasTag(tags, 'noLogin')) {
    const cfg = world.config;
    if (!cfg?.url || !cfg?.username || !cfg?.password) {
      reporter.logWarn(testEntry, 'Auto-login skipped: missing url/username/password in config');
      return;
    }

    try {
      await gotoWithRetry(world.page, cfg.url);
      const lp = new LoginPage(world.page);
      await lp.waitForReady();
      await lp.enterCredentials(cfg.username, cfg.password);
      await lp.clickLogin();
      await world.page
        .waitForURL((u) => !/\/login(\b|\/|\?|#|$)/i.test(String(u)), { timeout: 90_000 })
        .catch(() => {});
      // Record auto-login as a real "step" so it appears at the top of the report steps list.
      reporter.logStepPass(testEntry, 'Auto-login executed');
    } catch (e) {
      reporter.logStepFail(testEntry, 'Auto-login failed', e);
      throw e;
    }
  } else {
    reporter.logInfo(testEntry, 'Skipping auto-login due to noLogin tag');
  }
}

async function afterEach({ test, world, reporter, testEntry, failed }) {
  const tags = test.tags || [];

  // Auto-logout from hook is optional per testcase:
  // - tag excludeFromAfterHook => skip logout
  // - otherwise attempt a generic logout via LoginPage (skipped if already logged out)
  if (hasTag(tags, 'excludeFromAfterHook')) {
    reporter.logInfo(testEntry, 'Skipping auto-logout due to excludeFromAfterHook tag');
    return;
  }

  try {
    const lp = new LoginPage(world.page);
    const hasLogoutControl = await lp.isLogoutButtonVisible().catch(() => false);
    if (!hasLogoutControl) {
      // Test may have already logged itself out (e.g. it verifies logout as part of
      // its own assertions), or auto-login never happened. Nothing to clean up.
      reporter.logInfo(testEntry, 'Skipping auto-logout: no logout control visible (already logged out)');
      return;
    }

    await lp.logout();
    // Record auto-logout as a real "step" so it appears after scenario steps in the report.
    reporter.logStepPass(testEntry, 'Auto-logout executed');
  } catch (e) {
    // don't fail test due to logout issues
    reporter.logWarn(testEntry, `Logout failed: ${e?.message || e}`);
    if (!failed) {
      // only helpful when test otherwise passed
      reporter.logWarn(testEntry, 'Test passed but auto-logout failed; consider setting LOGOUT_BUTTON_SELECTOR / LOGOUT_MENU_TRIGGER_SELECTOR / LOGOUT_MENU_ITEM_SELECTOR');
    }
  }
}

module.exports = { beforeEach, afterEach };


