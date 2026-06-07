const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const Store = require('electron-store');

const store = new Store({ encryptionKey: 'cloaked-manager-local-key' });

let mainWindow;

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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow.close());

// ── Credentials ───────────────────────────────────────────────────────────────
ipcMain.handle('save-credentials', (_e, creds) => { store.set('credentials', creds); return { ok: true }; });
ipcMain.handle('load-credentials', ()           => store.get('credentials', null));

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
  if (!mainWindow) return;
  mainWindow.webContents.send('debug-log', {
    panel,
    level,
    message,
    ts: new Date().toISOString()
  });
}

// ── Shared browser launcher (fingerprint hardened) ────────────────────────────
async function launchBrowser(mode, panel) {
  dbg(panel, 'info', `Launching browser in ${mode} mode…`);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: mode === 'headless',
    args: mode === 'hidden' ? ['--window-position=-10000,-10000', '--window-size=1280,900'] : []
  });
  dbg(panel, 'success', 'Browser launched successfully');
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US', timezoneId: 'America/New_York', permissions: []
  });
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
  await page.goto('https://my.cloaked.com/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
  dbg(panel, 'success', `Page loaded — title: "${await page.title()}"`);

  // Cloaked may show a loading/splash screen before the login form renders.
  // Wait up to 15s for ANY input to appear on the page first.
  dbg(panel, 'info', 'Waiting for any input to appear on page (up to 15s)…');
  try {
    await page.waitForSelector('input', { timeout: 15000 });
    dbg(panel, 'success', 'At least one input found on page');
  } catch (e) {
    const title = await page.title().catch(() => 'unknown');
    const url   = page.url();
    const text  = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '');
    dbg(panel, 'error', `No inputs appeared after 15s. URL: ${url} | Title: "${title}"`);
    dbg(panel, 'verbose', `Page text preview: ${text}`);
    throw new Error(`Login page did not render any inputs. URL: ${url}`);
  }

  // Extra wait for JS-rendered forms (Alpine.js / React may need a moment)
  await page.waitForTimeout(5000);

  // Log ALL inputs currently on the page for diagnostics
  const allInputs = await page.evaluate(() =>
    [...document.querySelectorAll('input')].map(i =>
      `type="${i.type}" name="${i.name}" id="${i.id}" placeholder="${i.placeholder}"`
    )
  );
  dbg(panel, 'verbose', `All inputs on page: ${allInputs.join(' | ') || 'none'}`);

  // ── Step 1: Fill identifier ───────────────────────────────────────────────
  dbg(panel, 'info', 'Looking for identifier input (name="username" or id="username")…');
  const identifierInput = await page.$('input[name="username"], input[id="username"]');

  if (!identifierInput) {
    // Fallback — try any visible non-password input
    dbg(panel, 'warning', 'username input not found — trying fallback: first visible non-password input');
    const fallback = await page.$('input:not([type="password"]):not([type="hidden"])');
    if (!fallback) {
      dbg(panel, 'error', `No usable input found. All inputs: ${allInputs.join(' | ') || 'none'}`);
      throw new Error(`Could not find identifier input. Inputs on page: ${allInputs.join(', ') || 'none'}`);
    }
    dbg(panel, 'warning', 'Using fallback input — this may not be the correct field');
    await fallback.click();
    await page.waitForTimeout(200);
    for (const char of identifier) {
      await fallback.type(char, { delay: 40 + Math.random() * 60 });
    }
    dbg(panel, 'info', 'Identifier typed via fallback — pressing Enter');
    await page.waitForTimeout(400 + Math.random() * 300);
    await Promise.all([page.waitForTimeout(2000), fallback.press('Enter')]);
  } else {
    dbg(panel, 'success', 'Identifier input found');
    await page.waitForTimeout(800 + Math.random() * 400);
    await identifierInput.click();
    await page.waitForTimeout(200);
    dbg(panel, 'info', `Typing identifier (${identifier.length} chars)…`);
    for (const char of identifier) {
      await identifierInput.type(char, { delay: 40 + Math.random() * 60 });
    }
    dbg(panel, 'success', 'Identifier typed — pressing Enter');
    await page.waitForTimeout(400 + Math.random() * 300);
    await Promise.all([page.waitForTimeout(2000), identifierInput.press('Enter')]);
  }

  // ── Step 2: Password ──────────────────────────────────────────────────────
  dbg(panel, 'info', 'Waiting for password input (up to 15s)…');
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    dbg(panel, 'success', 'Password input found');
  } catch (e) {
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll('input')].map(i =>
        `type="${i.type}" name="${i.name}" id="${i.id}"`
      )
    );
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 300));
    dbg(panel, 'error', `Password input NOT found. Inputs: ${inputs.join(' | ') || 'none'}`);
    dbg(panel, 'verbose', `Page text: ${pageText}`);
    throw new Error(`Password field not found after submitting identifier. Inputs: ${inputs.join(', ') || 'none'}`);
  }

  await page.waitForTimeout(600 + Math.random() * 400);
  const passInput = await page.$('input[type="password"]');
  dbg(panel, 'info', `Typing password (${password.length} chars)…`);
  await passInput.click();
  await page.waitForTimeout(200);
  for (const char of password) {
    await passInput.type(char, { delay: 40 + Math.random() * 60 });
  }
  dbg(panel, 'success', 'Password typed — pressing Enter');
  await page.waitForTimeout(400 + Math.random() * 300);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch((e) => {
      dbg(panel, 'warning', `Navigation after password did not fire: ${e.message}`);
    }),
    passInput.press('Enter')
  ]);

  await page.waitForTimeout(3000);
  const postLoginTitle = await page.title().catch(() => 'unknown');
  const postLoginUrl   = page.url();
  dbg(panel, 'success', `Login complete — URL: ${postLoginUrl} | Title: "${postLoginTitle}"`);
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

  try {
    const mode = store.get('browserMode', 'headless');
    dbg('sync', 'info', `=== SYNC STARTED === mode: ${mode}`);
    mainWindow.webContents.send('sync-status', { stage: 'launching', message: 'Launching scraper browser…' });

    const { browser: b, context } = await launchBrowser(mode, 'sync');
    browser = b;
    const page = await context.newPage();

    mainWindow.webContents.send('sync-status', { stage: 'logging-in', message: 'Logging in…' });
    await loginToCloaked(page, email, password, 'sync');
    await capture(page, 'post-login');

    mainWindow.webContents.send('sync-status', { stage: 'fetching', message: 'Fetching aliases…' });
    await capture(page, 'dashboard-loaded');

    // ── Alias scraping ──────────────────────────────────────────────────────
    dbg('sync', 'info', 'Scraping alias cards from dashboard…');
    dbg('sync', 'verbose', 'Trying selectors: [data-testid*="identity"], [class*="identity"], [class*="Identity"], [class*="alias"], [class*="Alias"]');

    const { aliases, aliasDebug } = await page.evaluate(() => {
      const results = [];
      const debug   = [];
      const cards   = document.querySelectorAll('[data-testid*="identity"],[class*="identity"],[class*="Identity"],[class*="alias"],[class*="Alias"]');
      debug.push(`Found ${cards.length} candidate card elements`);
      cards.forEach((card, i) => {
        const text       = card.innerText || '';
        const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = text.match(/(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
        const nameEl     = card.querySelector('h2,h3,h4,[class*="name"],[class*="title"],strong');
        if (emailMatch || phoneMatch) {
          results.push({
            id: `alias-${i}`,
            name: nameEl ? nameEl.innerText.trim() : `Identity ${i + 1}`,
            email: emailMatch ? emailMatch[0] : null,
            phone: phoneMatch ? phoneMatch[0].trim() : null
          });
          debug.push(`Card ${i}: email=${emailMatch?.[0]||'—'} phone=${phoneMatch?.[0]||'—'}`);
        } else {
          debug.push(`Card ${i}: no email/phone found in text (first 80 chars: "${text.substring(0,80)}")`);
        }
      });
      // Fallback
      if (results.length === 0) {
        debug.push('No cards matched — trying full-page text fallback for @cloaked.app/@cloaked.com emails');
        const emails = [...document.body.innerText.matchAll(/[a-zA-Z0-9._%+\-]+@cloaked\.(app|com)/g)].map(m => m[0]);
        const unique  = [...new Set(emails)];
        debug.push(`Fallback found ${unique.length} unique cloaked emails`);
        unique.forEach((em, i) => results.push({ id: `alias-${i}`, name: `Alias ${i+1}`, email: em, phone: null }));
      }
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
    await browser.close();
    dbg('sync', 'success', `=== SYNC COMPLETE === aliases: ${aliases.length} codes: ${codes.length}`);
    mainWindow.webContents.send('sync-status', { stage: 'done', message: 'Sync complete!' });
    return { ok: true, aliases, codes, syncedAt: new Date().toISOString() };

  } catch (err) {
    dbg('sync', 'error', `=== SYNC FAILED === ${err.message}`);
    dbg('sync', 'verbose', err.stack || '(no stack trace)');
    if (browser) await browser.close().catch(() => {});
    mainWindow.webContents.send('sync-status', { stage: 'error', message: err.message });
    return { ok: false, error: err.message };
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
