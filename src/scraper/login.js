const { dbg } = require('../shared');

async function loginToCloaked(page, identifier, password, panel) {
  dbg(panel, 'info', `Navigating to https://my.cloaked.com/auth/login…`);
  await page.goto('https://my.cloaked.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  dbg(panel, 'success', `Page loaded — URL: ${page.url()}`);

  // Login form is inside a cross-origin iframe — page.locator() won't pierce it, must use frameLocator()
  dbg(panel, 'info', 'Waiting for auth iframe (secure.cloaked.com)…');
  await page.waitForSelector('iframe[src*="secure.cloaked.com"]', { timeout: 15000 });
  const frame = page.frameLocator('iframe[src*="secure.cloaked.com"]');
  dbg(panel, 'success', 'Auth iframe found');

  // Step 1: Username
  const usernameLocator = frame.locator('input#username, input[name="username"]').first();
  dbg(panel, 'info', 'Waiting for username input inside iframe…');
  await usernameLocator.waitFor({ state: 'visible', timeout: 20000 });
  dbg(panel, 'success', 'Username input found');

  await page.waitForTimeout(800 + Math.random() * 400);
  await usernameLocator.click();
  await page.waitForTimeout(200);
  dbg(panel, 'info', `Typing identifier (${identifier.length} chars)…`);
  await usernameLocator.pressSequentially(identifier, { delay: 90 + Math.random() * 80 });
  dbg(panel, 'success', 'Identifier typed — pressing Enter');
  await page.waitForTimeout(400 + Math.random() * 300);
  await usernameLocator.press('Enter');
  await page.waitForTimeout(2000);

  // Step 2: Password
  const passwordLocator = frame.locator('input[type="password"], input[name="password"]').first();
  dbg(panel, 'info', 'Waiting for password input…');
  await passwordLocator.waitFor({ state: 'visible', timeout: 15000 });
  dbg(panel, 'success', 'Password input found');

  await page.waitForTimeout(600 + Math.random() * 400);
  await passwordLocator.click();
  await page.waitForTimeout(200);
  dbg(panel, 'info', `Typing password (${password.length} chars)…`);
  await passwordLocator.pressSequentially(password, { delay: 90 + Math.random() * 80 });
  dbg(panel, 'success', 'Password typed — pressing Enter');
  await page.waitForTimeout(400 + Math.random() * 300);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
      dbg(panel, 'warning', `Navigation after password: ${e.message}`);
    }),
    passwordLocator.press('Enter')
  ]);

  await page.waitForTimeout(3000);
  dbg(panel, 'success', `Login complete — URL: ${page.url()} | Title: "${await page.title().catch(() => 'unknown')}"`);
}

module.exports = { loginToCloaked };