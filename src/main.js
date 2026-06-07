const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const Store = require('electron-store');

const store = new Store({ encryptionKey: 'cloaked-manager-local-key' });

let mainWindow;
let autoUpdater; // loaded lazily inside app.whenReady — electron-updater needs app to be ready

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 760, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function initAutoUpdater() {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'checking' });
  });
  autoUpdater.on('update-available', info => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'available', version: info.version, releaseNotes: info.releaseNotes });
  });
  autoUpdater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'not-available' });
  });
  autoUpdater.on('download-progress', progress => {
    if (mainWindow) mainWindow.webContents.send('download-progress', progress);
  });
  autoUpdater.on('update-downloaded', info => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', err => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'error', message: err.message });
  });
}

// ── Playwright Chromium first-launch check ────────────────────────────────────
async function ensurePlaywrightChromium() {
  const { chromium } = require('playwright');
  let installed = false;
  try {
    const execPath = chromium.executablePath();
    installed = fs.existsSync(execPath);
  } catch (_) {
    installed = false;
  }

  if (installed) {
    mainWindow.webContents.send('playwright-status', { stage: 'ready' });
    return;
  }

  mainWindow.webContents.send('playwright-status', { stage: 'installing', message: 'Setting up browser — this only happens once…' });

  await new Promise((resolve) => {
    let playwrightCli;
    try { playwrightCli = require.resolve('playwright/cli'); } catch (_) { playwrightCli = require.resolve('playwright-core/cli'); }

    const proc = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], { stdio: 'pipe' });

    proc.stdout.on('data', d => {
      const msg = d.toString().trim();
      if (msg) mainWindow.webContents.send('playwright-status', { stage: 'installing', message: msg });
    });

    proc.on('close', code => {
      mainWindow.webContents.send('playwright-status', {
        stage: code === 0 ? 'ready' : 'error',
        message: code === 0 ? 'Browser ready!' : 'Browser setup failed — run: npm run install-playwright'
      });
      resolve();
    });
  });
}

app.whenReady().then(async () => {
  initAutoUpdater();
  createWindow();

  mainWindow.webContents.once('did-finish-load', async () => {
    await ensurePlaywrightChromium();

    // Silent auto-check on startup — only in packaged app
    if (app.isPackaged) {
      setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4000);
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow.close());

// ── Auto-updater IPC ──────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(err => {
    if (mainWindow) mainWindow.webContents.send('update-status', { type: 'error', message: err.message });
  });
  return { ok: true };
});
ipcMain.handle('download-update', () => { autoUpdater.downloadUpdate(); return { ok: true }; });
ipcMain.on('restart-and-install', () => autoUpdater.quitAndInstall(true, true));

// ── Credentials ───────────────────────────────────────────────────────────────
ipcMain.handle('save-credentials', (_e, creds) => { store.set('credentials', creds); return { ok: true }; });
ipcMain.handle('load-credentials', ()           => store.get('credentials', null));

// ── Session ───────────────────────────────────────────────────────────────────
ipcMain.handle('clear-session', () => {
  const sessionPath = path.join(app.getPath('userData'), 'session-state.json');
  try { fs.unlinkSync(sessionPath); } catch (_) {}
  return { ok: true };
});

// ── Aliases ───────────────────────────────────────────────────────────────────
ipcMain.handle('save-aliases', (_e, a) => { store.set('aliases', a); return { ok: true }; });
ipcMain.handle('load-aliases', ()       => store.get('aliases', []));

// ── Mappings ──────────────────────────────────────────────────────────────────
ipcMain.handle('save-mappings', (_e, m) => { store.set('mappings', m); return { ok: true }; });
ipcMain.handle('load-mappings', ()       => store.get('mappings', {}));

// ── Browser mode ──────────────────────────────────────────────────────────────
ipcMain.handle('save-browser-mode', (_e, mode) => { store.set('browserMode', mode); return { ok: true }; });
ipcMain.handle('load-browser-mode', ()          => store.get('browserMode', 'headless'));

// ── Debug screenshot settings ─────────────────────────────────────────────────
ipcMain.handle('save-debug-settings', (_e, s) => { store.set('debugSettings', s); return { ok: true }; });
ipcMain.handle('load-debug-settings', ()       => store.get('debugSettings', { enabled: false }));

ipcMain.handle('open-debug-folder', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir); return { ok: true };
});

ipcMain.handle('list-debug-screenshots', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => {
    const full = path.join(dir, f), stat = fs.statSync(full);
    return { name: f, path: full, size: stat.size, mtime: stat.mtime.toISOString() };
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
});

ipcMain.handle('delete-debug-screenshot', (_e, p) => {
  try { fs.unlinkSync(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('clear-debug-screenshots', () => {
  const dir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (!fs.existsSync(dir)) return { ok: true };
  fs.readdirSync(dir).filter(f => f.endsWith('.png')).forEach(f => fs.unlinkSync(path.join(dir, f)));
  return { ok: true };
});

// ── External URLs ─────────────────────────────────────────────────────────────
ipcMain.on('open-external', (_e, url) => shell.openExternal(url));

// ── Debug log helper — sends structured log entries to the renderer ───────────
// panel: 'sync' | 'creator' | 'sms'
// level: 'info' | 'success' | 'warning' | 'error' | 'verbose'
function dbg(panel, level, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('debug-log', {
    panel,
    level,
    message,
    ts: new Date().toISOString()
  });
}

// ── Shared browser launcher (fingerprint hardened) ────────────────────────────
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

// ── Login helper (shared by scraper + creator) ────────────────────────────────
async function loginToCloaked(page, identifier, password, panel) {
  dbg(panel, 'info', `Navigating to https://my.cloaked.com/auth/login…`);
  await page.goto('https://my.cloaked.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  dbg(panel, 'success', `Page loaded — URL: ${page.url()}`);

  // The login form lives inside a cross-origin iframe at secure.cloaked.com.
  // page.locator() pierces shadow DOM but NOT cross-origin iframes — must use frameLocator().
  dbg(panel, 'info', 'Waiting for auth iframe (secure.cloaked.com)…');
  await page.waitForSelector('iframe[src*="secure.cloaked.com"]', { timeout: 15000 });
  const frame = page.frameLocator('iframe[src*="secure.cloaked.com"]');
  dbg(panel, 'success', 'Auth iframe found');

  // ── Step 1: Username ──────────────────────────────────────────────────────
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

  // ── Step 2: Password ──────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS 1 — SCRAPER
// ═══════════════════════════════════════════════════════════════════════════════
ipcMain.handle('sync-cloaked', async (_e, { email, password }) => {
  let browser;
  const debugSettings = store.get('debugSettings', { enabled: false });
  const debugDir = path.join(app.getPath('userData'), 'debug-screenshots');
  if (debugSettings.enabled && !fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let ssIdx = 0;

  async function capture(page, label) {
    if (!debugSettings.enabled) return;
    const filename = `${timestamp}_${String(ssIdx++).padStart(2,'0')}_${label}.png`;
    await page.screenshot({ path: path.join(debugDir, filename), fullPage: true });
    mainWindow.webContents.send('sync-status', { stage: 'screenshot', message: `📸 ${filename}` });
    dbg('sync', 'verbose', `Screenshot saved: ${filename}`);
    await page.waitForTimeout(400);
  }

  const sessionPath = path.join(app.getPath('userData'), 'session-state.json');

  try {
    const mode = store.get('browserMode', 'headless');
    dbg('sync', 'info', `=== SYNC STARTED === mode: ${mode}`);
    mainWindow.webContents.send('sync-status', { stage: 'launching', message: 'Launching scraper browser…' });

    const hasSession = fs.existsSync(sessionPath);
    const { browser: b, context } = await launchBrowser(mode, 'sync', hasSession ? sessionPath : null);
    browser = b;

    let browserClosedByUser = false;
    browser.on('disconnected', () => {
      browserClosedByUser = true;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      dbg('sync', 'warning', 'Browser window closed — aborting sync');
      mainWindow.webContents.send('sync-status', { stage: 'error', message: 'Browser closed — sync aborted' });
    });

    const page = await context.newPage();

    if (hasSession) {
      dbg('sync', 'info', 'Checking saved session…');
      mainWindow.webContents.send('sync-status', { stage: 'logging-in', message: 'Restoring session…' });
      await page.goto('https://my.cloaked.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (page.url().includes('/auth/')) {
        dbg('sync', 'warning', 'Session expired — logging in again…');
        mainWindow.webContents.send('sync-status', { stage: 'logging-in', message: 'Session expired, logging in…' });
        await loginToCloaked(page, email, password, 'sync');
        await context.storageState({ path: sessionPath });
        dbg('sync', 'success', 'New session saved');
      } else {
        dbg('sync', 'success', `Session valid — login skipped (URL: ${page.url()})`);
      }
    } else {
      mainWindow.webContents.send('sync-status', { stage: 'logging-in', message: 'Logging in…' });
      await loginToCloaked(page, email, password, 'sync');
      await context.storageState({ path: sessionPath });
      dbg('sync', 'success', 'Session saved — future syncs will skip login');
    }
    await capture(page, 'post-login');

    mainWindow.webContents.send('sync-status', { stage: 'fetching', message: 'Enabling Advanced Mode…' });
    await capture(page, 'post-login');

    // ── Enable Advanced Mode (required every page load — not persisted by Cloaked) ──
    dbg('sync', 'info', 'Waiting for Advanced Mode toggle to appear…');
    const advancedToggle = page.locator('button.navigation-advanced-toggle__button-toggle[aria-label="Toggle"]');
    try {
      await advancedToggle.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      throw new Error('Advanced features toggle not found after 15s — cannot scrape aliases without Advanced Mode');
    }
    const isAdvancedOn = await advancedToggle.getAttribute('aria-pressed').catch(() => 'false');
    if (isAdvancedOn === 'true') {
      dbg('sync', 'info', 'Advanced Mode already on');
    } else {
      await advancedToggle.click();
      dbg('sync', 'success', 'Advanced features toggle clicked — waiting for confirmation modal…');

      const tryAdvancedBtn = page.locator('button.advanced-mode-modal__button.base-button--primary-fill');
      try {
        await tryAdvancedBtn.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        throw new Error('"Try Advanced" button not found — cannot continue without Advanced Mode');
      }
      await tryAdvancedBtn.click();
      dbg('sync', 'success', '"Try Advanced" confirmed');
      await page.waitForTimeout(1500);
    }

    // ── Navigate to All Identities tab ─────────────────────────────────────
    dbg('sync', 'info', 'Looking for All Identities tab…');
    try {
      const allIdentitiesTab = page.locator([
        'a:has-text("All Identities")',
        'button:has-text("All Identities")',
        '[role="tab"]:has-text("All Identities")',
      ].join(', ')).first();

      if (await allIdentitiesTab.count() > 0) {
        await allIdentitiesTab.click();
        dbg('sync', 'success', 'Clicked All Identities tab');
        await page.waitForTimeout(2000);
      } else {
        dbg('sync', 'warning', 'All Identities tab not found — scraping current view');
      }
    } catch (e) {
      dbg('sync', 'warning', `All Identities navigation error: ${e.message}`);
    }

    mainWindow.webContents.send('sync-status', { stage: 'fetching', message: 'Fetching aliases…' });
    await capture(page, 'identities-page');
    await page.waitForTimeout(1500);

    // ── Alias scraping ──────────────────────────────────────────────────────
    dbg('sync', 'info', 'Scraping identity cards…');

    const { aliases, aliasDebug } = await page.evaluate(() => {
      const results = [];
      const debug   = [];
      const seen    = new Set();

      const cloakedEmailRe = /[a-zA-Z0-9._%+\-]+@cloaked\.(app|com)/i;

      // Each identity is a div.item with a numeric id
      const items = [...document.querySelectorAll('div.item[id]')]
        .filter(el => /^\d+$/.test(el.id));
      debug.push(`Found ${items.length} identity card(s)`);

      items.forEach((item, i) => {
        // Name: h1.base-text--callout-emphasized holds the identity name
        const h1     = item.querySelector('h1.base-text--callout-emphasized');
        const cardEl = item.querySelector('[aria-label^="Cloak card for "]');
        const name   = h1?.innerText.trim()
          || cardEl?.getAttribute('aria-label').replace('Cloak card for ', '').trim()
          || `Identity ${i + 1}`;

        // Each card has two div.base-text--footnote-regular — first is empty,
        // second has the phone number. Pick the first non-empty one.
        const phoneEls = [...item.querySelectorAll('div.base-text--footnote-regular')];
        const phone    = phoneEls.map(el => el.innerText.trim()).find(t => t.length > 0) || null;

        // Email: some identities use a @cloaked.app address instead of a phone
        const emailMatch = (item.innerText || '').match(cloakedEmailRe);
        const email      = emailMatch ? emailMatch[0].toLowerCase() : null;

        const key = phone || email || name;
        if (phone || email) {
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ id: item.id, name, email, phone });
            debug.push(`[${item.id}] "${name}": phone=${phone||'—'} email=${email||'—'}`);
          } else {
            debug.push(`[${item.id}] "${name}": duplicate (${key}) skipped`);
          }
        } else {
          debug.push(`[${item.id}] "${name}": no phone or email found`);
        }
      });

      return { aliases: results, aliasDebug: debug };
    });

    aliasDebug.forEach(line => dbg('sync', aliases.length > 0 ? 'verbose' : 'warning', line));
    if (aliases.length > 0) {
      dbg('sync', 'success', `Found ${aliases.length} alias(es)`);
      aliases.forEach(a => dbg('sync', 'verbose', `  → ${a.name}: email=${a.email||'—'} phone=${a.phone||'—'}`));
    } else {
      dbg('sync', 'warning', 'No aliases found — selectors may need updating. Enable debug screenshots to inspect the page.');
    }

    // ── Code scraping ───────────────────────────────────────────────────────
    mainWindow.webContents.send('sync-status', { stage: 'messages', message: 'Fetching codes…' });
    dbg('sms', 'info', '=== SMS/CODE SCAN STARTED ===');
    dbg('sms', 'verbose', 'Trying selectors: [class*="message"], [class*="Message"], [class*="inbox"], [class*="sms"], [class*="email-item"]');

    const { codes, codeDebug } = await page.evaluate(() => {
      const msgs  = [];
      const debug = [];
      const items = document.querySelectorAll('[class*="message"],[class*="Message"],[class*="inbox"],[class*="Inbox"],[class*="sms"],[class*="email-item"]');
      debug.push(`Found ${items.length} candidate message elements`);
      items.forEach((item, i) => {
        const text      = item.innerText || '';
        const codeMatch = text.match(/\b\d{4,8}\b/);
        if (codeMatch) {
          msgs.push({ id: `code-${i}`, code: codeMatch[0], preview: text.substring(0, 120).trim(), timestamp: new Date().toISOString() });
          debug.push(`Item ${i}: matched code "${codeMatch[0]}" — preview: "${text.substring(0,60)}"`);
        } else if (text.trim()) {
          debug.push(`Item ${i}: no code pattern found — text: "${text.substring(0,60)}"`);
        }
      });
      return { codes: msgs, codeDebug: debug };
    });

    codeDebug.forEach(line => dbg('sms', codes.length > 0 ? 'verbose' : 'warning', line));
    if (codes.length > 0) {
      dbg('sms', 'success', `Found ${codes.length} code(s)`);
      codes.forEach(c => dbg('sms', 'verbose', `  → Code: ${c.code} | Preview: ${c.preview.substring(0,60)}`));
    } else {
      dbg('sms', 'warning', 'No codes found — inbox may be empty or selectors need updating');
    }

    await capture(page, 'done');
    if (mode === 'visible') {
      dbg('sync', 'info', 'Visible mode — browser left open for inspection. Close it manually when done.');
    } else {
      await browser.close();
    }
    dbg('sync', 'success', `=== SYNC COMPLETE === aliases: ${aliases.length} codes: ${codes.length}`);
    mainWindow.webContents.send('sync-status', { stage: 'done', message: 'Sync complete!' });
    return { ok: true, aliases, codes, syncedAt: new Date().toISOString() };

  } catch (err) {
    const closedByUser = browserClosedByUser ||
      /target closed|browser.*disconnected|target page.*closed/i.test(err.message);
    if (closedByUser) {
      dbg('sync', 'warning', '=== SYNC ABORTED — browser closed by user ===');
      // sync-status already sent by the disconnected handler
    } else {
      dbg('sync', 'error', `=== SYNC FAILED === ${err.message}`);
      dbg('sync', 'verbose', err.stack || '(no stack trace)');
      mainWindow.webContents.send('sync-status', { stage: 'error', message: err.message });
    }
    if (browser && !closedByUser && mode !== 'visible') await browser.close().catch(() => {});
    return { ok: false, error: closedByUser ? 'Browser closed by user' : err.message };
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESS 2 — ALIAS CREATOR
// ═══════════════════════════════════════════════════════════════════════════════
function bellCurveDelay() {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round((z * 25 + 110) * 1000);
  return Math.max(60000, Math.min(180000, ms));
}

const creatorState = { running: false, paused: false, stopped: false, browser: null };

function sendCreatorEvent(type, payload) {
  mainWindow.webContents.send('creator-event', { type, ...payload });
}

ipcMain.handle('creator-start', async (_e, { tasks, email, password }) => {
  if (creatorState.running) return { ok: false, error: 'Already running' };
  creatorState.running = true; creatorState.paused = false; creatorState.stopped = false;
  runCreator(tasks, email, password).catch(err => {
    sendCreatorEvent('error', { message: err.message });
    dbg('creator', 'error', `Unhandled creator error: ${err.message}`);
    creatorState.running = false;
  });
  return { ok: true };
});

ipcMain.handle('creator-pause',  () => { creatorState.paused  = true;  dbg('creator', 'warning', 'Paused by user'); return { ok: true }; });
ipcMain.handle('creator-resume', () => { creatorState.paused  = false; dbg('creator', 'info',    'Resumed by user'); return { ok: true }; });
ipcMain.handle('creator-stop',   () => { creatorState.stopped = true; creatorState.paused = false; dbg('creator', 'warning', 'Stop requested by user'); return { ok: true }; });

async function runCreator(tasks, email, password) {
  let browser;
  try {
    const mode = store.get('browserMode', 'headless');
    dbg('creator', 'info', `=== CREATOR STARTED === ${tasks.length} task(s) | mode: ${mode}`);
    sendCreatorEvent('status', { message: 'Launching creator browser…' });

    const { browser: b, context } = await launchBrowser(mode, 'creator');
    browser = b; creatorState.browser = browser;
    const page = await context.newPage();

    sendCreatorEvent('status', { message: 'Logging in…' });
    await loginToCloaked(page, email, password, 'creator');
    dbg('creator', 'success', 'Login complete — starting task loop');
    sendCreatorEvent('status', { message: 'Logged in. Starting alias creation…' });

    for (let i = 0; i < tasks.length; i++) {
      if (creatorState.stopped) { sendCreatorEvent('stopped', { message: 'Stopped by user.' }); break; }
      while (creatorState.paused && !creatorState.stopped) await new Promise(r => setTimeout(r, 500));
      if (creatorState.stopped) { sendCreatorEvent('stopped', { message: 'Stopped by user.' }); break; }

      const task = tasks[i];
      dbg('creator', 'info', `--- Task ${i+1}/${tasks.length}: "${task.accountName}" (${task.aliasType}) ---`);
      sendCreatorEvent('task-start', { id: task.id, message: `Creating alias for ${task.accountName}…` });

      try {
        dbg('creator', 'info', 'Navigating to dashboard…');
        await page.goto('https://my.cloaked.com/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        dbg('creator', 'success', `Dashboard loaded — URL: ${page.url()}`);

        // Find create button
        dbg('creator', 'verbose', 'Looking for create/add identity button…');
        const createBtn = await page.$('[data-testid*="create"],[class*="create"],button:has-text("Create"),button:has-text("Add"),button:has-text("New"),[aria-label*="create" i],[aria-label*="add" i]');
        if (!createBtn) {
          const btns = await page.evaluate(() =>
            [...document.querySelectorAll('button')].map(b => `"${b.innerText.trim()}"`)
          );
          dbg('creator', 'error', `Create button not found. Buttons on page: ${btns.join(', ') || 'none'}`);
          throw new Error(`Could not find create identity button. Buttons found: ${btns.join(', ') || 'none'}`);
        }
        dbg('creator', 'success', 'Create button found — clicking');
        await createBtn.click();
        await page.waitForTimeout(1500);

        // Select alias type
        dbg('creator', 'info', `Selecting alias type: ${task.aliasType}`);
        if (task.aliasType === 'phone') {
          const phoneOpt = await page.$('[data-testid*="phone"],[class*="phone"],button:has-text("Phone"),label:has-text("Phone")');
          if (phoneOpt) { await phoneOpt.click(); dbg('creator', 'success', 'Phone option selected'); }
          else dbg('creator', 'warning', 'Phone option not found — may already be selected or not required');
        } else {
          const emailOpt = await page.$('[data-testid*="email"],[class*="email"],button:has-text("Email"),label:has-text("Email")');
          if (emailOpt) { await emailOpt.click(); dbg('creator', 'success', 'Email option selected'); }
          else dbg('creator', 'warning', 'Email option not found — may already be selected or not required');
        }
        await page.waitForTimeout(1000);

        // Confirm
        dbg('creator', 'info', 'Looking for confirm/generate button…');
        const confirmBtn = await page.$('button:has-text("Generate"),button:has-text("Create"),button:has-text("Confirm"),button:has-text("Next"),button[type="submit"]');
        if (confirmBtn) { await confirmBtn.click(); dbg('creator', 'success', 'Confirm button clicked'); }
        else dbg('creator', 'warning', 'No confirm button found — may have auto-confirmed');
        await page.waitForTimeout(3000);

        // Detect new alias
        dbg('creator', 'info', 'Scraping newly created alias from page…');
        const newAlias = await page.evaluate((type) => {
          const text = document.body.innerText;
          if (type === 'phone') {
            const m = text.match(/(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
            return m ? m[0].trim() : null;
          } else {
            const m = text.match(/[a-zA-Z0-9._%+\-]+@cloaked\.(app|com)/);
            return m ? m[0] : null;
          }
        }, task.aliasType);

        if (!newAlias) {
          const pagePreview = await page.evaluate(() => document.body.innerText.substring(0, 400));
          dbg('creator', 'error', `Could not detect new alias on page. Page text preview: ${pagePreview}`);
          throw new Error('Alias created but could not detect the new value — check debug screenshots');
        }

        dbg('creator', 'success', `New alias detected: ${newAlias}`);

        // Auto-save mapping
        const mappings = store.get('mappings', {});
        const newId    = `created-${Date.now()}`;
        mappings[newId] = { label: task.accountName, forwardTo: '' };
        store.set('mappings', mappings);
        dbg('creator', 'success', `Mapping saved: "${task.accountName}" → ${newAlias} (id: ${newId})`);

        sendCreatorEvent('task-done', { id: task.id, aliasValue: newAlias, aliasType: task.aliasType, accountName: task.accountName, mappingId: newId });

      } catch (err) {
        dbg('creator', 'error', `Task failed: ${err.message}`);
        sendCreatorEvent('task-failed', { id: task.id, error: err.message });
      }

      // Bell-curve delay
      if (i < tasks.length - 1 && !creatorState.stopped) {
        const delay    = bellCurveDelay();
        const delaySec = Math.round(delay / 1000);
        dbg('creator', 'info', `Waiting ${delaySec}s before next task (bell-curve delay)`);
        sendCreatorEvent('waiting', { id: task.id, delayMs: delay, delaySec });
        const start = Date.now();
        while (Date.now() - start < delay) {
          if (creatorState.stopped) break;
          while (creatorState.paused && !creatorState.stopped) await new Promise(r => setTimeout(r, 500));
          await new Promise(r => setTimeout(r, 1000));
          const remaining = Math.max(0, Math.round((delay - (Date.now() - start)) / 1000));
          sendCreatorEvent('countdown', { id: task.id, remaining });
        }
      }
    }

    await browser.close();
    creatorState.browser = null; creatorState.running = false;
    dbg('creator', 'success', '=== CREATOR COMPLETE ===');
    sendCreatorEvent('complete', { message: 'All tasks finished.' });

  } catch (err) {
    dbg('creator', 'error', `=== CREATOR FAILED === ${err.message}`);
    dbg('creator', 'verbose', err.stack || '(no stack)');
    if (browser) await browser.close().catch(() => {});
    creatorState.browser = null; creatorState.running = false;
    sendCreatorEvent('error', { message: err.message });
  }
}
