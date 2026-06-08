const fs = require('fs');
const { dbg } = require('../shared');

async function launchBrowser(mode, panel, sessionPath = null) {
  dbg(panel, 'info', `Launching browser in ${mode} mode…`);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: mode === 'headless',
    args: mode === 'hidden' ? ['--window-position=-10000,-10000', '--window-size=1280,900'] : []
  });
  dbg(panel, 'success', 'Browser launched successfully');

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US', timezoneId: 'America/New_York', permissions: []
  };
  if (sessionPath && fs.existsSync(sessionPath)) {
    contextOptions.storageState = sessionPath;
    dbg(panel, 'info', 'Restoring saved session state…');
  }

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',    { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages',  { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });
  dbg(panel, 'verbose', 'Browser context created with fingerprint hardening applied');
  return { browser, context };
}

module.exports = { launchBrowser };