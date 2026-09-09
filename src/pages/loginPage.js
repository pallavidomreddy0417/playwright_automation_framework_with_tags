/**
 * Playwright Page Object for Login page.
 * Update selectors to match your AUT.
 */
class LoginPage {
  #username;
  #password;
  #loginButton;
  #resolved = false;
  #tried = null;

  constructor(page) {
    this.page = page;
  }

  async #firstExisting(candidates) {
    for (const sel of candidates) {
      if (!sel) continue;
      const loc = this.page.locator(sel);
      try {
        const count = await loc.count();
        if (count > 0) return { locator: loc.first(), selector: sel };
      } catch (_) {
        // ignore invalid selector and keep trying
      }
    }
    return null;
  }

  /**
   * Like #firstExisting, but polls for up to timeoutMs since the candidates may not be
   * in the DOM yet (e.g. a menu that opens via a CSS transition or async render after a click).
   */
  async #firstExistingWithWait(candidates, timeoutMs = 3000) {
    const start = Date.now();
    let found = await this.#firstExisting(candidates);
    while (!found && Date.now() - start < timeoutMs) {
      await this.page.waitForTimeout(150);
      found = await this.#firstExisting(candidates);
    }
    return found;
  }

  async #ensureLocators() {
    if (this.#resolved) return;

    const userSel = process.env.LOGIN_USERNAME_SELECTOR;
    const passSel = process.env.LOGIN_PASSWORD_SELECTOR;
    const btnSel = process.env.LOGIN_BUTTON_SELECTOR;

    const usernameCandidates = [
      userSel,
      '#username',
      'input#email',
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[autocomplete="username"]',
      'input[placeholder*="Email" i]',
      'input[placeholder*="User" i]',
      'input[id*="user" i]',
      'input[id*="email" i]'
    ];

    const passwordCandidates = [
      passSel,
      '#password',
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
      'input[placeholder*="Password" i]',
      'input[id*="pass" i]'
    ];

    const buttonCandidates = [
      btnSel,
      '#submit',
      'button[type="submit"]',
      'button[id*="submit" i]',
      'button[id*="login" i]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Sign-in")',
      'button:has-text("Submit")',
      'a:has-text("Sign-in")',
      'input[type="submit"]'
    ];

    this.#tried = { usernameCandidates, passwordCandidates, buttonCandidates };

    const u = await this.#firstExisting(usernameCandidates);
    const p = await this.#firstExisting(passwordCandidates);
    const b = await this.#firstExisting(buttonCandidates);

    if (!u || !p || !b) {
      const url = this.page.url();
      const missing = [
        !u ? 'username' : null,
        !p ? 'password' : null,
        !b ? 'loginButton' : null
      ].filter(Boolean).join(', ');

      throw new Error(
        `LoginPage: could not resolve locator(s): ${missing}\n` +
        `URL: ${url}\n` +
        `Tip: set env vars LOGIN_USERNAME_SELECTOR / LOGIN_PASSWORD_SELECTOR / LOGIN_BUTTON_SELECTOR to match your app.\n` +
        `Tried username selectors: ${usernameCandidates.filter(Boolean).join(' | ')}\n` +
        `Tried password selectors: ${passwordCandidates.filter(Boolean).join(' | ')}\n` +
        `Tried button selectors: ${buttonCandidates.filter(Boolean).join(' | ')}`
      );
    }

    this.#username = u.locator;
    this.#password = p.locator;
    this.#loginButton = b.locator;
    this.#resolved = true;
  }

  async waitForReady() {
    await this.#ensureLocators();
    await this.#username.waitFor({ state: 'visible' });
    await this.#password.waitFor({ state: 'visible' });
  }

  async login(user, pass) {
    await this.#ensureLocators();
    await this.enterCredentials(user, pass);
    await this.clickLogin();
  }

  async enterCredentials(user, pass) {
    await this.#ensureLocators();
    await this.#username.fill(user);
    await this.#password.fill(pass);
  }

  async clickLogin() {
    await this.#ensureLocators();
    await this.#loginButton.click();
  }

  #directLogoutCandidates() {
    return [
      process.env.LOGOUT_BUTTON_SELECTOR,
      '#logout',
      'a#logout',
      'button#logout',
      'a[id*="logout" i]',
      'button[id*="logout" i]',
      'a:has-text("Logout")',
      'a:has-text("Log out")',
      'a:has-text("Sign out")',
      'button:has-text("Logout")',
      'button:has-text("Log out")',
      'button:has-text("Sign out")'
    ];
  }

  // Some apps hide the logout action behind a profile/avatar menu that must
  // be opened first (e.g. a "Profile" button revealing a "Logout" menu item).
  #menuTriggerCandidates() {
    return [
      process.env.LOGOUT_MENU_TRIGGER_SELECTOR,
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      'button:has-text("Profile")',
      '[role="button"]:has-text("Profile")'
    ];
  }

  #menuItemCandidates() {
    return [
      process.env.LOGOUT_MENU_ITEM_SELECTOR,
      '[role="menuitem"]:has-text("Logout")',
      '[role="menuitem"]:has-text("Log out")',
      '[role="menuitem"]:has-text("Sign out")',
      'li:has-text("Logout")',
      'a:has-text("Logout")',
      'button:has-text("Logout")'
    ];
  }

  /**
   * Resolves how to log out on the current page: either a direct logout
   * control, or a menu trigger that must be opened first to reveal one.
   * Returns { type: 'direct', locator } or { type: 'menu', trigger, item }.
   */
  async #resolveLogout() {
    const direct = await this.#firstExisting(this.#directLogoutCandidates());
    if (direct) return { type: 'direct', locator: direct.locator };

    const trigger = await this.#firstExisting(this.#menuTriggerCandidates());
    if (trigger) return { type: 'menu', trigger: trigger.locator };

    return null;
  }

  async isLogoutButtonVisible() {
    const resolved = await this.#resolveLogout();
    if (!resolved) return false;
    const target = resolved.type === 'direct' ? resolved.locator : resolved.trigger;
    return target.isVisible();
  }

  async logout() {
    const resolved = await this.#resolveLogout();
    if (!resolved) {
      throw new Error(
        `LoginPage: could not resolve a logout control (direct button/link, or a profile menu trigger).\n` +
        `URL: ${this.page.url()}\n` +
        `Tip: set LOGOUT_BUTTON_SELECTOR for a direct logout control, or LOGOUT_MENU_TRIGGER_SELECTOR + ` +
        `LOGOUT_MENU_ITEM_SELECTOR for a profile-menu based logout.\n` +
        `Tried direct selectors: ${this.#directLogoutCandidates().filter(Boolean).join(' | ')}\n` +
        `Tried menu trigger selectors: ${this.#menuTriggerCandidates().filter(Boolean).join(' | ')}`
      );
    }

    if (resolved.type === 'direct') {
      await resolved.locator.click();
      return;
    }

    await resolved.trigger.click();
    const item = await this.#firstExistingWithWait(this.#menuItemCandidates());
    if (!item) {
      throw new Error(
        `LoginPage: opened the profile menu but could not find a Logout menu item.\n` +
        `URL: ${this.page.url()}\n` +
        `Tip: set env var LOGOUT_MENU_ITEM_SELECTOR to match your app.\n` +
        `Tried menu item selectors: ${this.#menuItemCandidates().filter(Boolean).join(' | ')}`
      );
    }
    await item.locator.click();
  }
}

module.exports = { LoginPage };


