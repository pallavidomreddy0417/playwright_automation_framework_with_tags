const { expect } = require('chai');
const { loadConfig } = require('../src/config/config');
const { LoginPage } = require('../src/pages/loginPage');

function toStepError(stepName, err) {
  if (err instanceof Error) {
    const wrapped = new Error(`${stepName} failed: ${err.message}`);
    wrapped.cause = err;
    return wrapped;
  }
  return new Error(`${stepName} failed: ${String(err)}`);
}

async function runSafeStep(ctx, stepName, fn) {
  return ctx.step(stepName, async () => {
    try {
      return await fn();
    } catch (err) {
      throw toStepError(stepName, err);
    }
  });
}

async function verifyLogoutAndReturnToLogin(ctx, page, lp, cfg) {
  await runSafeStep(ctx, 'verify logout button is visible', async () => {
    const visible = await lp.isLogoutButtonVisible();
    expect(visible).to.equal(true);
  });

  await runSafeStep(ctx, 'user clicks logout button', async () => {
    await lp.logout();
  });

  await runSafeStep(ctx, 'verify user is redirected to login screen after logout', async () => {
    const expectedUrl = process.env.LOGOUT_REDIRECT_URL || cfg.url;
    await page.waitForURL((u) => normalizeUrlForAssert(u.href) === normalizeUrlForAssert(expectedUrl), { timeout: 60_000 });
    const actualUrl = page.url();
    console.log(`[LOGOUT ASSERT] Expected login URL: ${expectedUrl}`);
    console.log(`[LOGOUT ASSERT] Actual URL after logout: ${actualUrl}`);
    expect(normalizeUrlForAssert(actualUrl)).to.equal(normalizeUrlForAssert(expectedUrl));
  });
}

function normalizeUrlForAssert(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    // Keep query parameters (critical for routes like index.php?r=...).
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString().toLowerCase();
  } catch (_) {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}


/**
 * Simple tagged test definition format:
 * module.exports = [{ name, tags: ['smoke','regression'], run(ctx) }]
 */
module.exports = [
  {
    name: 'Login: valid credentials (smoke)',
    // This test performs its own login + logout assertions, so the framework's
    // auto-logout afterEach hook is skipped to avoid a redundant second logout attempt.
    tags: ['smoke', 'login', 'regression'],
    async run(ctx) {
      try {
        const page = ctx.page;
        let cfg;
        let lp;

        await runSafeStep(ctx, 'load and validate login config', async () => {
          cfg = loadConfig();
          if (!cfg.url) {
            throw new Error(
              `Missing login URL for Environment=${cfg.environment} Role=${cfg.role}. ` +
                `Set ${cfg.envPrefix}${cfg.roleSegment}Url or ${cfg.envPrefix}url in config/testdata.properties`
            );
          }
          if (!cfg.username || !cfg.password) throw new Error('Missing username/password in config/testdata.properties');
        });

        await runSafeStep(ctx, 'initialize login page object', async () => {
          lp = new LoginPage(page);
        });

        await runSafeStep(ctx, 'user navigates to login page', async () => {
          await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
        });

        await runSafeStep(ctx, 'user enters credentials', async () => {
          await lp.waitForReady();
          await lp.enterCredentials(cfg.username, cfg.password);
        });

        await runSafeStep(ctx, 'user clicks on login button', async () => {
          await lp.clickLogin();
        });

        // For QA Admin, explicitly wait for the dashboard URL and assert it.
        // You can override this via ADMIN_DASHBOARD_URL / ADMIN_DASHBOARD_SUCCESS_TEXT,
        // or via QAAdminDashboardUrl / QAAdminDashboardSuccessText in config/testdata.properties.
        if (String(cfg.envPrefix).toLowerCase() === 'qa' && String(cfg.roleSegment).toLowerCase() === 'admin') {
          const expectedUrl = process.env.ADMIN_DASHBOARD_URL || cfg.dashboardUrl;
          const expectedSuccessText = process.env.ADMIN_DASHBOARD_SUCCESS_TEXT || cfg.dashboardSuccessText;

          await runSafeStep(ctx, 'verify admin dashboard URL after login', async () => {
            await page.waitForURL((u) => normalizeUrlForAssert(u.href) === normalizeUrlForAssert(expectedUrl), { timeout: 60_000 });
            const actualUrl = page.url();
            console.log(`[LOGIN ASSERT] Expected Admin dashboard URL: ${expectedUrl}`);
            console.log(`[LOGIN ASSERT] Actual URL after login: ${actualUrl}`);
            expect(normalizeUrlForAssert(actualUrl)).to.equal(normalizeUrlForAssert(expectedUrl));
          });

          if (expectedSuccessText) {
            await runSafeStep(ctx, 'verify admin dashboard success text visible', async () => {
              const loc = page.getByText(expectedSuccessText, { exact: false }).first();
              await loc.waitFor({ state: 'visible', timeout: 60_000 });
              expect(await loc.isVisible()).to.equal(true);
            });
          }

          await verifyLogoutAndReturnToLogin(ctx, page, lp, cfg);
          return;
        }

        // For QA Tenant, explicitly wait for the dashboard URL and assert it.
        // You can override this via TENANT_DASHBOARD_URL when needed.
        if (String(cfg.envPrefix).toLowerCase() === 'qa' && String(cfg.roleSegment).toLowerCase() === 'tenant') {
          await runSafeStep(ctx, 'verify tenant dashboard URL after login', async () => {
            const expectedUrl = process.env.TENANT_DASHBOARD_URL || cfg.dashboardUrl;
            await page.waitForURL((u) => normalizeUrlForAssert(u.href) === normalizeUrlForAssert(expectedUrl), { timeout: 60_000 });
            const actualUrl = page.url();
            console.log(`[LOGIN ASSERT] Expected Tenant dashboard URL: ${expectedUrl}`);
            console.log(`[LOGIN ASSERT] Actual URL after login: ${actualUrl}`);
            expect(normalizeUrlForAssert(actualUrl)).to.equal(normalizeUrlForAssert(expectedUrl));
          });
          await verifyLogoutAndReturnToLogin(ctx, page, lp, cfg);
          return;
        }

        // You must set DASHBOARD_PATH (or DASHBOARD_SELECTOR) to make this assertion meaningful for your app.
        const dashPath = process.env.DASHBOARD_PATH;
        const dashSelector = process.env.DASHBOARD_SELECTOR;

        if (dashSelector) {
          await runSafeStep(ctx, 'verify dashboard selector is visible', async () => {
            await page.locator(dashSelector).first().waitFor({ state: 'visible', timeout: 60_000 });
            expect(await page.locator(dashSelector).first().isVisible()).to.equal(true);
          });
          await verifyLogoutAndReturnToLogin(ctx, page, lp, cfg);
          return;
        }

        if (dashPath) {
          await runSafeStep(ctx, 'verify dashboard url contains expected path', async () => {
            await page.waitForURL(new RegExp(dashPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), { timeout: 60_000 });
            expect(page.url().toLowerCase()).to.contain(dashPath.toLowerCase());
          });
          await verifyLogoutAndReturnToLogin(ctx, page, lp, cfg);
          return;
        }

        // Fallback: at least ensure the page is still responsive after login click.
        await runSafeStep(ctx, 'verify page is responsive after login', async () => {
          await page.waitForTimeout(500);
          expect(await page.title()).to.be.a('string');
        });

        await verifyLogoutAndReturnToLogin(ctx, page, lp, cfg);
      } catch (err) {
        ctx.setLastException?.(err);
        throw err;
      }
    }
  },
  {
    name: 'Login: check login with invalid password (error message visible)',
    tags: ['smoke', 'login', 'regression', 'noLogin', 'excludeFromAfterHook'],
    async run(ctx) {
      try {
        const page = ctx.page;
        let cfg;
        let lp;

        await runSafeStep(ctx, 'load and validate invalid-login config', async () => {
          cfg = loadConfig();
          if (!cfg.url) {
            throw new Error(
              `Missing login URL for Environment=${cfg.environment} Role=${cfg.role}. ` +
                `Set ${cfg.envPrefix}${cfg.roleSegment}Url or ${cfg.envPrefix}url in config/testdata.properties`
            );
          }
          if (!cfg.username) throw new Error('Missing username in config/testdata.properties');
          if (!cfg.invalidPassword) {
            throw new Error(
              `Missing invalid password for Role=${cfg.role}. Add invalid${cfg.envPrefix}${cfg.roleSegment}Password (or Invalid…) in config/testdata.properties`
            );
          }
        });

        await runSafeStep(ctx, 'initialize login page object', async () => {
          lp = new LoginPage(page);
        });

        await runSafeStep(ctx, 'user navigates to login page', async () => {
          await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
        });

        await runSafeStep(ctx, 'user enters valid username and invalid password', async () => {
          await lp.waitForReady();
          await lp.enterCredentials(cfg.username, cfg.invalidPassword);
        });

        await runSafeStep(ctx, 'user clicks on login button', async () => {
          await lp.clickLogin();
        });

        await runSafeStep(ctx, 'verify login error message is visible', async () => {
          const expected = process.env.LOGIN_ERROR_TEXT || cfg.loginErrorText || 'Invalid Username or Password';
          const selector = process.env.LOGIN_ERROR_SELECTOR;
          if (selector) {
            const errorEl = page.locator(selector).first();
            await errorEl.waitFor({ state: 'visible', timeout: 60_000 });
            expect(await errorEl.isVisible()).to.equal(true);
            const actual = (await errorEl.innerText()).trim().toLowerCase();
            expect(actual).to.contain(expected.trim().toLowerCase());
            return;
          }

          // Prefer exact match first, then fallback to contains if the app adds extra text.
          const exact = page.getByText(expected, { exact: true });
          const loose = page.getByText(expected, { exact: false });

          const loc = (await exact.count().catch(() => 0)) > 0 ? exact.first() : loose.first();
          await loc.waitFor({ state: 'visible', timeout: 60_000 });
          expect(await loc.isVisible()).to.equal(true);
        });
      } catch (err) {
        ctx.setLastException?.(err);
        throw err;
      }
    }
  }
];


