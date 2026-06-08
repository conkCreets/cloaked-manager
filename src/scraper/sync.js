const { ipcMain, app } = require('electron');
const path = require('path');
const fs   = require('fs');
const { store, dbg, getMainWindow } = require('../shared');
const { launchBrowser }             = require('./browser');
const { checkAndRestoreSession, enableAdvancedMode, scrapeAliases, scrapeCodes } = require('./scrape');

const BROWSER_CLOSED_RE = /target closed|browser.*disconnected|target page.*closed/i;

function sessionPath() {
  return path.join(app.getPath('userData'), 'session-state.json');
}

function sendStatus(stage, message) {
  const w = getMainWindow();
  if (w) w.webContents.send('sync-status', { stage, message });
}

// Sets up browser, session, and returns { browser, context, page, mode, isClosedByUser }
// Cleans up the browser itself if something fails before returning.
async function setupBrowser(email, password, panel) {
  const sp = sessionPath();
  const mode = store.get('browserMode', 'headless');
  const hasSession = fs.existsSync(sp);
  const { browser, context } = await launchBrowser(mode, panel, hasSession ? sp : null);

  let closedByUser = false;
  browser.on('disconnected', () => {
    closedByUser = true;
    const w = getMainWindow();
    if (!w || w.isDestroyed()) return;
    dbg(panel, 'warning', 'Browser window closed — aborting sync');
    sendStatus('error', 'Browser closed — sync aborted');
  });

  try {
    const page = await context.newPage();
    sendStatus('logging-in', hasSession ? 'Checking session…' : 'Logging in…');
    await checkAndRestoreSession(page, context, email, password, sp, panel, hasSession);
    return { browser, context, page, mode, isClosedByUser: () => closedByUser };
  } catch (err) {
    if (!closedByUser && mode !== 'visible') await browser.close().catch(() => {});
    throw err;
  }
}

function handleError(err, browser, mode, isClosedByUser, panel) {
  const closed = isClosedByUser() || BROWSER_CLOSED_RE.test(err.message);
  if (closed) {
    dbg(panel, 'warning', '=== SYNC ABORTED — browser closed by user ===');
  } else {
    dbg(panel, 'error', `=== SYNC FAILED === ${err.message}`);
    dbg(panel, 'verbose', err.stack || '(no stack trace)');
    sendStatus('error', err.message);
  }
  if (browser && !closed && mode !== 'visible') browser.close().catch(() => {});
  return { ok: false, error: closed ? 'Browser closed by user' : err.message };
}

// ── Full sync (aliases + codes) ───────────────────────────────────────────────
ipcMain.handle('sync-cloaked', async (_e, { email, password }) => {
  let browser, mode;
  let isClosedByUser = () => false;

  const debugSettings = store.get('debugSettings', { enabled: false });
  const debugDir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (debugSettings.enabled && !fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let ssIdx = 0;

  try {
    dbg('sync', 'info', '=== FULL SYNC STARTED ===');
    sendStatus('launching', 'Launching scraper browser…');

    const setup = await setupBrowser(email, password, 'sync');
    ({ browser, mode, isClosedByUser } = { browser: setup.browser, mode: setup.mode, isClosedByUser: setup.isClosedByUser });
    const { page } = setup;

    async function capture(label) {
      if (!debugSettings.enabled) return;
      const filename = `${timestamp}_${String(ssIdx++).padStart(2, '0')}_${label}.png`;
      await page.screenshot({ path: path.join(debugDir, filename), fullPage: true });
      sendStatus('screenshot', `📸 ${filename}`);
      dbg('sync', 'verbose', `Screenshot saved: ${filename}`);
      await page.waitForTimeout(400);
    }

    await capture('post-login');
    sendStatus('fetching', 'Enabling Advanced Mode…');
    await enableAdvancedMode(page, 'sync');

    sendStatus('fetching', 'Fetching aliases…');
    await capture('identities-page');
    const aliases = await scrapeAliases(page, 'sync');

    sendStatus('messages', 'Fetching codes…');
    dbg('sms', 'info', '=== SMS/CODE SCAN STARTED ===');
    const codes = await scrapeCodes(page, 'sms');

    await capture('done');
    if (mode === 'visible') {
      dbg('sync', 'info', 'Visible mode — browser left open for inspection. Close it manually when done.');
    } else {
      await browser.close();
    }

    dbg('sync', 'success', `=== SYNC COMPLETE === aliases: ${aliases.length} codes: ${codes.length}`);
    sendStatus('done', 'Sync complete!');
    return { ok: true, aliases, codes, syncedAt: new Date().toISOString() };

  } catch (err) {
    return handleError(err, browser, mode, isClosedByUser, 'sync');
  }
});

// ── Codes-only sync ───────────────────────────────────────────────────────────
ipcMain.handle('sync-codes', async (_e, { email, password }) => {
  let browser, mode;
  let isClosedByUser = () => false;

  try {
    dbg('sms', 'info', '=== CODES-ONLY SYNC STARTED ===');
    sendStatus('launching', 'Launching browser…');

    const setup = await setupBrowser(email, password, 'sms');
    ({ browser, mode, isClosedByUser } = { browser: setup.browser, mode: setup.mode, isClosedByUser: setup.isClosedByUser });
    const { page } = setup;

    sendStatus('fetching', 'Enabling Advanced Mode…');
    await enableAdvancedMode(page, 'sms');

    sendStatus('messages', 'Fetching codes…');
    const codes = await scrapeCodes(page, 'sms');

    if (mode !== 'visible') await browser.close();
    else dbg('sms', 'info', 'Visible mode — browser left open.');

    dbg('sms', 'success', `=== CODES SYNC COMPLETE === ${codes.length} new code(s)`);
    sendStatus('done', 'Codes synced!');
    return { ok: true, codes };

  } catch (err) {
    return handleError(err, browser, mode, isClosedByUser, 'sms');
  }
});

// ── Aliases-only sync ─────────────────────────────────────────────────────────
ipcMain.handle('sync-aliases', async (_e, { email, password }) => {
  let browser, mode;
  let isClosedByUser = () => false;

  try {
    dbg('sync', 'info', '=== ALIASES-ONLY SYNC STARTED ===');
    sendStatus('launching', 'Launching browser…');

    const setup = await setupBrowser(email, password, 'sync');
    ({ browser, mode, isClosedByUser } = { browser: setup.browser, mode: setup.mode, isClosedByUser: setup.isClosedByUser });
    const { page } = setup;

    sendStatus('fetching', 'Enabling Advanced Mode…');
    await enableAdvancedMode(page, 'sync');

    sendStatus('fetching', 'Fetching aliases…');
    const aliases = await scrapeAliases(page, 'sync');

    if (mode !== 'visible') await browser.close();
    else dbg('sync', 'info', 'Visible mode — browser left open.');

    dbg('sync', 'success', `=== ALIASES SYNC COMPLETE === ${aliases.length} alias(es)`);
    sendStatus('done', 'Aliases synced!');
    return { ok: true, aliases, syncedAt: new Date().toISOString() };

  } catch (err) {
    return handleError(err, browser, mode, isClosedByUser, 'sync');
  }
});