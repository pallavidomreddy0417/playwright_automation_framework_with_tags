const fs = require('node:fs');
const path = require('node:path');

function envGet(k) {
  return process.env[k] ?? process.env[String(k).toUpperCase()] ?? process.env[String(k).toLowerCase()];
}

function propGet(props, k) {
  return props[k] ?? props[String(k).toUpperCase()] ?? props[String(k).toLowerCase()];
}

function pickParam(props, k, fallback) {
  return envGet(k) ?? propGet(props, k) ?? fallback;
}

/**
 * Maps Environment label to the credential/url prefix used in testdata.properties.
 * Examples: QA → QAAdminUrl, Staging → StagePortalUsername, Production → Productionurl.
 */
function resolveEnvPrefix(environment) {
  const e = String(environment ?? '').trim().toLowerCase();
  if (e.startsWith('prod')) return 'Production';
  if (e === 'qa' || e.startsWith('qa')) return 'QA';
  return 'Stage';
}

/** Normalizes role for property keys (Admin, Tenant, Portal, …). */
function roleKeySegment(role) {
  const r = String(role ?? '').trim();
  if (!r) return '';
  const lower = r.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeRoleLoginUrl(url, envPrefix, roleSeg) {
  const raw = String(url ?? '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const isRoot = (u.pathname === '/' || u.pathname === '') && !u.search;
    // QA tenant root redirects to auth login in browser; normalize eagerly for stable automation.
    if (String(envPrefix).toLowerCase() === 'qa' && String(roleSeg).toLowerCase() === 'tenant' && isRoot) {
      u.pathname = '/index.php';
      u.search = 'r=auth%2Fauth%2Flogin';
      return u.toString();
    }
    return u.toString();
  } catch (_) {
    return raw;
  }
}

/**
 * Finalize Environment using priority:
 * Jenkins/CLI -> process.env -> properties file -> fallback
 */
function finalizeEnvironment(props, fallback = 'Staging') {
  const env = String(pickParam(props, 'Environment', fallback) ?? fallback).trim() || fallback;
  // Keep process.env aligned so the rest of the framework (and report metadata) is consistent.
  if (!envGet('Environment')) process.env.Environment = env;
  return env;
}

/**
 * Finalize Role using priority:
 * Jenkins/CLI -> process.env -> properties file -> fallback
 */
function finalizeRole(props, fallback = 'Admin') {
  const role = String(pickParam(props, 'Role', pickParam(props, 'role', fallback)) ?? fallback).trim() || fallback;
  if (!envGet('Role')) process.env.Role = role;
  return role;
}

function finalizeBrowser(props, fallback = 'chromium') {
  const browser = String(pickParam(props, 'browser', pickParam(props, 'Browser', fallback)) ?? fallback).trim() || fallback;
  if (!envGet('browser') && !envGet('Browser')) process.env.browser = browser;
  return browser;
}

function parseProperties(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function loadConfig() {
  const filePath = path.join(process.cwd(), 'config', 'testdata.properties');
  const exists = fs.existsSync(filePath);
  const props = exists ? parseProperties(fs.readFileSync(filePath, 'utf8')) : {};

  const get = (k, fallback) => pickParam(props, k, fallback);

  // Match your old Java concept (now reusable):
  // Environment = System.getenv("Environment") else properties else default
  // Role        = System.getenv("Role")        else properties else default Admin
  const environment = finalizeEnvironment(props, 'Staging'); // Staging/Production
  const role = finalizeRole(props, 'Admin'); // Admin / Tenant / Portal / …
  const browser = finalizeBrowser(props, 'chromium'); // chrome/chromium/firefox/webkit

  const envPrefix = resolveEnvPrefix(environment);
  const roleSeg = roleKeySegment(role);

  // Prefer role-specific URL when Admin and Tenant use different login pages (e.g. QA).
  const rawUrl =
    get(`${envPrefix}${roleSeg}Url`) ??
    get(`${envPrefix}${roleSeg}url`) ??
    get(`${envPrefix}URL`) ??
    get(`${envPrefix}url`);
  const url = normalizeRoleLoginUrl(rawUrl, envPrefix, roleSeg);

  // Credentials resolution (supports your existing key patterns)
  const username =
    get(`${envPrefix}${roleSeg}Username`) ??
    get(`${envPrefix}${roleSeg}UserName`) ??
    get(`${envPrefix}${roleSeg}PortalUsername`) ??
    get(`${envPrefix}${roleSeg}`);

  const password =
    get(`${envPrefix}${roleSeg}Password`) ??
    get(`${envPrefix}${roleSeg}UserPassword`) ?? // e.g. StagePortalUserPassword
    get(`${envPrefix}${roleSeg}Pwd`);

  const invalidUsername =
    get(`Invalid${envPrefix}${roleSeg}Username`) ??
    get(`Invalid${envPrefix}${roleSeg}UserName`) ?? // tolerate casing
    get(`Invalid${envPrefix}${roleSeg}`);

  const invalidPassword =
    get(`invalid${envPrefix}${roleSeg}Password`) ??
    get(`Invalid${envPrefix}${roleSeg}Password`) ??
    get(`invalid${envPrefix}${roleSeg}UserPassword`) ??
    get(`Invalid${envPrefix}${roleSeg}UserPassword`);

  // Optional: expected error text for the invalid-login test, since it differs per AUT.
  const loginErrorText = get(`${envPrefix}${roleSeg}LoginErrorText`);

  // Optional: expected post-login dashboard URL/text, since it differs per AUT.
  const dashboardUrl = get(`${envPrefix}${roleSeg}DashboardUrl`);
  const dashboardSuccessText = get(`${envPrefix}${roleSeg}DashboardSuccessText`);

  return {
    raw: props,
    filePath,
    hasFile: exists,
    environment,
    role,
    browser,
    envPrefix,
    roleSegment: roleSeg,
    url,
    username,
    password,
    invalidUsername,
    invalidPassword,
    loginErrorText,
    dashboardUrl,
    dashboardSuccessText
  };
}

module.exports = {
  loadConfig,
  finalizeEnvironment,
  finalizeRole,
  finalizeBrowser,
  resolveEnvPrefix,
  roleKeySegment
};


