# Playwright Web Automation

A custom Playwright + Node.js UI test automation framework — no `@playwright/test` runner. It uses a hand-rolled test runner (`runner.js`) with tag-based test selection, environment/role-aware configuration, Extent + Allure reporting, and a ready-to-use Jenkins pipeline.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (bundled with Node.js)
- make sure chrome installed

## Setup

```bash
npm install
npx playwright install
```

## Running tests

The runner discovers all `*.spec.js` files under `tests/` and filters them by a tag expression.

```bash
# Run the default tag expression ("smoke")
node runner.js

# Run tests matching a tag expression
node runner.js --tags "smoke"
node runner.js --tags "smoke and login"

# Run a single spec file
node runner.js --file tests/login.spec.js

# Run a single test by matching its name
node runner.js --test "invalid password"

# Jenkins-style: override environment, role, and browser via flags
node runner.js --env Staging --role Admin --browser chrome --tags "smoke"
```

Or via npm scripts:

```bash
npm test              # node runner.js (default tags)
npm run test:smoke    # --tags smoke
npm run test:regression  # --tags regression
```

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `Environment` | Target environment (`QA`, `Staging`, `Production`) | `Staging` |
| `Role` | Login role (`Admin`, `Tenant`, …) | `Admin` |
| `browser` | Browser to launch (`chrome`, `chromium`, `firefox`, `webkit`) | `chromium` |
| `TAGS` | Tag expression (used when `--tags` isn't passed) | `smoke` |
| `HEADLESS` | Run headless | `false` |
| `MAXIMIZE` | Maximize window when headed | `true` |
| `REPORT_FLUSH_EACH_TEST` | Write the report after every test | `true` |

CLI flags (`--env`, `--role`, `--browser`, `--tags`) take priority over environment variables, which take priority over `config/testdata.properties`, which falls back to built-in defaults.

> **Windows note:** environment variable names are case-insensitive at the OS level on Windows, so `browser` and `BROWSER` (or `Environment`/`ENVIRONMENT`) are the same variable there. If some other tool on your machine sets `BROWSER` for its own purposes, it will affect this framework's browser selection too unless you override it explicitly (`--browser` flag or `config/testdata.properties`). This is a Windows OS characteristic, not framework-specific behavior — on Linux/macOS these names are distinct.

## Project structure

```
runner.js                  Custom test runner (discovery, tag filtering, execution, reporting)
src/
  config/config.js         Resolves Environment/Role/Browser + credentials/URLs per environment
  factory/driverFactory.js Playwright browser/context/page lifecycle
  framework/
    tagExpr.js              Tag expression compiler (and/or/not over tag lists)
    discoverTests.js         Finds and loads *.spec.js files under tests/
    stepRunner.js             Step/reporting helpers attached to each test context
    testHooks.js               beforeEach/afterEach (e.g. auto-login/logout)
  reporting/
    extentReporter.js        Extent-style HTML report writer
    allureReporter.js         Allure results writer + HTML generation
  pages/                    Page Object classes
config/
  testdata.properties       Per-environment URLs, credentials, and expected text
tests/
  *.spec.js                 Test suites (export tagged test objects)
```

## Architecture guide

This section explains what each file does and how they fit together, so you can navigate the codebase without reading every line.

### How a test run flows

1. `runner.js` parses CLI flags/env vars, loads `config/testdata.properties` via **`config.js`**, and resolves the tag expression via **`tagExpr.js`**.
2. **`discoverTests.js`** walks `tests/` for `*.spec.js` files and loads the arrays of test objects they export.
3. Tests are filtered down by the tag matcher (and optionally by `--file`/`--test`).
4. For each selected test, `runner.js`:
   - creates a fresh `world` object and calls **`driverFactory.js`** to launch the browser/context/page,
   - calls **`testHooks.js`**'s `beforeEach` (clears cookies, auto-logs in via **`loginPage.js`**),
   - runs the test's own `run(ctx)` function (see `tests/login.spec.js`), where `ctx` has been enriched by **`stepRunner.js`** with a `ctx.step(...)` helper,
   - on failure, takes a screenshot,
   - calls `testHooks.js`'s `afterEach` (auto-logout, unless the test opted out),
   - reports the result via **`extentReporter.js`** and, if enabled, **`allureReporter.js`**, then closes the browser.
5. After all tests run, `runner.js` writes the final `reports/extent-report.html`, generates the Allure HTML report (locally), and zips the `reports/` folder.

### File-by-file reference

| File | Role |
|---|---|
| **`runner.js`** | The entry point and orchestrator. Parses `--tags`/`--file`/`--test`/`--env`/`--role`/`--browser` CLI flags, resolves config, discovers and filters tests, then loops over each selected test running the launch → hooks → test → hooks → report → close sequence described above. Also creates `reports.zip` at the end. |
| **`src/config/config.js`** | Reads `config/testdata.properties` and resolves the final `Environment`/`Role`/`browser` using the priority chain **CLI flag → env var → properties file → built-in default**. From those, it builds the property-key prefix (e.g. `Environment=QA` + `Role=Admin` → `QAAdmin`) and looks up the matching URL/username/password/invalid-password/expected-dashboard keys, returning one `cfg` object used everywhere else (login page, hooks, test assertions). |
| **`src/factory/driverFactory.js`** | Wraps Playwright's `chromium`/`firefox`/`webkit` launch + context + page creation into a single `initDriver(world, browserName)` call, honoring `HEADLESS`, `MAXIMIZE`, `SLOWMO_MS`, `DEFAULT_TIMEOUT_MS`, `NAV_TIMEOUT_MS`. It retries the browser launch once on failure (see [Troubleshooting](#troubleshooting)) and exposes `closeDriver(world)` to tear everything down safely (each close step is wrapped so one failure doesn't block the others). |
| **`src/framework/tagExpr.js`** | A small hand-written parser/compiler for boolean tag expressions (`smoke`, `smoke and login`, `not regression`, parentheses). `compileTagExpr(expr)` returns a `(tags) => boolean` matcher function that `runner.js` uses to filter tests. |
| **`src/framework/discoverTests.js`** | `discoverTestFiles(dir)` recursively walks a directory for `*.spec.js` files. `loadTestsFromFile(path)` `require()`s a spec file and returns its exported array of test objects, tagging each with `__file` (used for report grouping by feature). |
| **`src/framework/stepRunner.js`** | `attachStepHelpers(...)` adds a `ctx.step(name, fn)` helper to the test context. Every step's pass/fail is logged to whichever reporter(s) are active, and a failure inside a step is captured as `ctx.lastException` and re-thrown so the test fails. This is what produces the readable step-by-step timeline you see in the HTML report. |
| **`src/framework/testHooks.js`** | Runner-level before/after logic that applies to every test, equivalent to a global "Before/After" hook: `beforeEach` clears cookies (unless tagged `keepCookies`) and auto-logs in via `LoginPage` (unless tagged `noLogin`); `afterEach` auto-logs out via `LoginPage` (unless tagged `excludeFromAfterHook`). Also includes `gotoWithRetry`, which retries `page.goto` with progressively more lenient `waitUntil` modes to ride out slow/flaky page loads. |
| **`src/pages/loginPage.js`** | The framework's one Page Object, `LoginPage`. It doesn't hardcode selectors — instead it tries a prioritized list of common selectors for the username field, password field, login button, and logout control (direct button/link or a "profile menu → Logout item" pattern), so it works against many login pages out of the box. Every candidate list can be overridden via env vars (`LOGIN_USERNAME_SELECTOR`, `LOGIN_PASSWORD_SELECTOR`, `LOGIN_BUTTON_SELECTOR`, `LOGOUT_BUTTON_SELECTOR`, `LOGOUT_MENU_TRIGGER_SELECTOR`, `LOGOUT_MENU_ITEM_SELECTOR`) so you can point it at your own app. If it can't resolve a selector it throws a descriptive error listing everything it tried. |
| **`src/reporting/extentConfig.js`** | Reads optional theming/branding overrides from `reports/extentconfig.xml` (report name, headline, theme, document title, timeline toggle), falling back to sane defaults if the file doesn't exist. |
| **`src/reporting/extentReporter.js`** | `ExtentReporter` builds the self-contained `reports/extent-report.html` — a single HTML file (inline CSS/JS, no external dependencies) with a dashboard (pass/fail pie chart, per-feature summary table), a filterable test list with expandable step timelines, a screenshot viewer with zoom/pan, and a timeline view. It accumulates test results in memory as the run progresses and re-writes the file after each test (unless `REPORT_FLUSH_EACH_TEST=false`). |
| **`src/reporting/allureReporter.js`** | `AllureReporter` writes standard Allure `allure-results/*-result.json` files using the official `allure-js-commons` SDK, so results can be consumed by `allure generate`, `allure open`, or the Jenkins Allure plugin. `createCompositeReporter(extentReporter, allureReporter)` fans out every reporting call to both reporters at once, so `runner.js` only has to talk to one `reporter` object regardless of which reporters are enabled. Also exposes helpers to check whether Allure is enabled (`ALLURE` env var), whether to auto-generate the local HTML report (`ALLURE_AUTO_GENERATE`, off by default on Jenkins/CI), and to shell out to `npx allure generate`. |
| **`config/testdata.properties`** | Per-environment, per-role test data: login URL, username, password, an intentionally-invalid password (for negative tests), and optional expected dashboard URL/text and error text. Keys follow the pattern `{Environment}{Role}{Field}`, e.g. `QAAdminUrl`, `QAAdminUsername`, `QAAdminPassword`, `invalidQAAdminPassword`. |
| **`tests/login.spec.js`** | The example test suite and the pattern to copy for new tests. Each file exports an array of `{ name, tags, async run(ctx) }` objects. Inside `run`, use `ctx.step('description', async () => { ... })` to wrap each logical step (this is what shows up in the report), and Chai's `expect` for assertions. This file demonstrates: loading config, using `LoginPage`, asserting a post-login dashboard URL/text, and a full login → logout flow. |

### Writing your own test

1. Add per-environment credentials/URLs to `config/testdata.properties` (or override via env vars).
2. Create `tests/<name>.spec.js` exporting an array like:
   ```js
   module.exports = [
     {
       name: 'My new test',
       tags: ['smoke'],
       async run(ctx) {
         await ctx.step('do something', async () => {
           await ctx.page.goto('https://example.com');
         });
       }
     }
   ];
   ```
3. If your app's login/logout controls don't match the default selectors tried by `LoginPage`, set the `LOGIN_*`/`LOGOUT_*` selector env vars described above.
4. Run it: `node runner.js --file tests/<name>.spec.js`.

## Configuration data

`config/testdata.properties` holds per-environment/role URLs and credentials, keyed like `QAAdminUrl`, `QAAdminUsername`, `QAAdminPassword`. The values checked into this repo point at the public demo site [practicetestautomation.com](https://practicetestautomation.com/practice-test-login/) with its published demo credentials — safe to keep in a public repo. If you extend this framework against a real application, override sensitive values via environment variables rather than committing them to this file.

## Reports

After a run:

- Extent HTML report: `reports/extent-report.html`
- Allure raw results: `allure-results/`
- Allure HTML report (auto-generated locally unless running in CI): `allure-report/`
- A zipped copy of the `reports/` folder: `reports.zip`

To regenerate/view the Allure report manually:

```bash
npm run allure:generate
npm run allure:open
```

## Troubleshooting

**`browserType.launch: Target page, context or browser has been closed`** — the browser process starts and then dies immediately, before Playwright can connect to it. This is a local-machine issue, not a code bug (the runner auto-retries the launch once for exactly this reason). Common causes and fixes:

1. **You downloaded this repo as a ZIP into `Downloads` instead of using `git clone`.** Windows marks files extracted from a downloaded ZIP as untrusted ("Mark of the Web"), and antivirus/EDR software often kills a freshly-extracted, unrecognized `chrome.exe` the first time it runs. Fix: use `git clone` instead, or right-click the ZIP → Properties → **Unblock** before extracting, and/or move the extracted folder out of `Downloads`.
2. **Corrupted/incomplete browser download.** Reinstall the browser binaries: `npx playwright install --force`.
3. **Antivirus/EDR quarantined `chrome.exe`.** Check your AV's quarantine/logs around the failure time.
4. **Headed-window issues** (e.g. no display / remote session). Try `HEADLESS=true` (PowerShell: `$env:HEADLESS='true'`) to rule this out.

## Continuous Integration

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs the smoke tests on every push/PR to `main`, across Ubuntu, Windows, and macOS runners — so anyone forking or cloning this repo gets an automatic pass/fail signal without needing Jenkins. Reports are uploaded as build artifacts on each run.

## Jenkins

A declarative `Jenkinsfile` is included with parameters for `Environment`, `Role`, `Browser`, and `Tags`. It installs dependencies, runs the suite via `runner.js`, and archives `reports/`, `allure-results/`, and `reports.zip` as build artifacts (plus publishing an Allure report if the Allure Jenkins plugin is installed).

To use it:

1. Create a Pipeline job in Jenkins pointing at this repository's `Jenkinsfile`.
2. Run with parameters, e.g. `Environment=QA`, `Role=Admin`, `Browser=chrome`, `Tags=smoke`.

> The `Jenkinsfile` uses Windows batch steps (`bat`). If your Jenkins agent runs Linux/macOS, replace `bat` with `sh` and adjust the command syntax (e.g. `%Environment%` → `$Environment`).

## License

[MIT](LICENSE)
