const { chromium, firefox, webkit } = require('playwright');

function envMs(name, fallbackMs) {
  const raw = process.env[name];
  if (raw == null) return fallbackMs;
  const s = String(raw).trim();
  if (!s) return fallbackMs;
  const n = Number(s);
  // guard against NaN / negatives / zero
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return Math.floor(n);
}

/**
 * Browser management (thread-safe equivalent for JS):
 * Cucumber runs each scenario with its own World instance.
 * We store browser/context/page on the World (per-scenario), which is safe for parallel execution.
 */
class DriverFactory {
  static async applyMaximize(world, normalized, maximizeWidth, maximizeHeight) {
    if (!world?.page) return;
    try {
      if (normalized === 'chromium') {
        // Keep Chromium tied to the actual browser window dimensions.
        await world.page.setViewportSize({ width: maximizeWidth, height: maximizeHeight });
      } else {
        // Firefox/WebKit: enforce a large viewport regardless of host defaults.
        await world.page.setViewportSize({ width: maximizeWidth, height: maximizeHeight });
      }
      // Best-effort native resize for headed runs; harmless if browser blocks it.
      await world.page.evaluate(({ width, height }) => {
        try {
          window.moveTo(0, 0);
          window.resizeTo(width, height);
        } catch (_) {
        }
      }, { width: maximizeWidth, height: maximizeHeight });
    } catch (_) {
      // Ignore maximize errors; test flow should continue.
    }
  }

  /**
   * Initialize Browser/Context/Page on the provided Cucumber World.
   * Supports: chromium, firefox, webkit.
   */
  static async initDriver(world, browserName = 'chromium') {
    const headlessEnv = process.env.HEADLESS;
    // Default to headed mode so browser is visible unless explicitly forced headless.
    // HEADLESS=true  -> headless
    // HEADLESS=false -> headed
    const headless = headlessEnv == null ? false : String(headlessEnv).toLowerCase() === 'true';
    const slowMoMsRaw = process.env.SLOWMO_MS;
    const slowMo = slowMoMsRaw == null || String(slowMoMsRaw).trim() === '' ? 0 : Number(slowMoMsRaw);
    const maximizeEnv = process.env.MAXIMIZE;
    const maximize = maximizeEnv == null
      ? !headless // default: maximize when running headed
      : String(maximizeEnv).toLowerCase() === 'true';
    const maximizeWidth = envMs('MAXIMIZE_WIDTH', 1920);
    const maximizeHeight = envMs('MAXIMIZE_HEIGHT', 1080);

    const name = String(browserName).toLowerCase();
    // aliases
    const normalized =
      name === 'chrome' ? 'chromium' :
      name === 'msedge' ? 'chromium' :
      name;
    const browserType =
      normalized === 'firefox' ? firefox :
      normalized === 'webkit' ? webkit :
      chromium;

    const launchArgs = [];
    if (maximize && normalized === 'chromium') {
      launchArgs.push('--start-maximized');
    }
    // Firefox does not support Chromium's --start-maximized flag.
    // Use native CLI width/height arguments so headed runs open large by default.
    if (maximize && normalized === 'firefox') {
      launchArgs.push('-width', String(maximizeWidth), '-height', String(maximizeHeight));
    }

    const launchOptions = {
      headless,
      slowMo: Number.isFinite(slowMo) ? slowMo : 0,
      args: launchArgs.length ? launchArgs : undefined
    };

    world.browser = await browserType.launch(launchOptions);

    // Chromium can rely on the real browser window when start-maximized is used.
    // For Firefox/WebKit, use a large viewport as a maximize equivalent.
    const contextOptions = maximize
      ? (normalized === 'chromium'
        ? { viewport: null }
        : { viewport: { width: maximizeWidth, height: maximizeHeight } })
      : {};
    world.context = await world.browser.newContext(contextOptions);
    world.page = await world.context.newPage();
    if (maximize) {
      await DriverFactory.applyMaximize(world, normalized, maximizeWidth, maximizeHeight);
    }

    // More forgiving defaults for real apps (override via env vars)
    // - DEFAULT_TIMEOUT_MS: applies to most Playwright waits/actions (default 60000)
    // - NAV_TIMEOUT_MS: applies to navigations like page.goto (default = DEFAULT_TIMEOUT_MS)
    const defaultTimeoutMs = envMs('DEFAULT_TIMEOUT_MS', 60_000);
    const navTimeoutMs = envMs('NAV_TIMEOUT_MS', defaultTimeoutMs);
    world.page.setDefaultTimeout(defaultTimeoutMs);
    world.page.setDefaultNavigationTimeout(navTimeoutMs);
  }

  static getPage(world) {
    if (!world || !world.page) {
      throw new Error('Page is not initialized. Did you forget to run the Cucumber Before hook?');
    }
    return world.page;
  }

  static async closeDriver(world) {
    // Close in reverse creation order
    try {
      if (world?.page) await world.page.close();
    } catch (_) {
    } finally {
      if (world) world.page = null;
    }

    try {
      if (world?.context) await world.context.close();
    } catch (_) {
    } finally {
      if (world) world.context = null;
    }

    try {
      if (world?.browser) await world.browser.close();
    } catch (_) {
    } finally {
      if (world) world.browser = null;
    }
  }
}

module.exports = { DriverFactory };


