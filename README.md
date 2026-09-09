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
