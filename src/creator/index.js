const { ipcMain } = require('electron');
const { store, dbg, getMainWindow } = require('../shared');
const { launchBrowser }   = require('../scraper/browser');
const { loginToCloaked }  = require('../scraper/login');

function bellCurveDelay() {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = Math.round((z * 25 + 110) * 1000);
  return Math.max(60000, Math.min(180000, ms));
}

const creatorState = { running: false, paused: false, stopped: false, browser: null };

function sendCreatorEvent(type, payload) {
  const w = getMainWindow();
  if (w) w.webContents.send('creator-event', { type, ...payload });
}

ipcMain.handle('creator-start', async (_e, { tasks, email, password }) => {
  if (creatorState.running) return { ok: false, error: 'Already running' };
  creatorState.running = true;
  creatorState.paused  = false;
  creatorState.stopped = false;
  runCreator(tasks, email, password).catch(err => {
    sendCreatorEvent('error', { message: err.message });
    dbg('creator', 'error', `Unhandled creator error: ${err.message}`);
    creatorState.running = false;
  });
  return { ok: true };
});

ipcMain.handle('creator-pause',  () => { creatorState.paused  = true;  dbg('creator', 'warning', 'Paused by user');          return { ok: true }; });
ipcMain.handle('creator-resume', () => { creatorState.paused  = false; dbg('creator', 'info',    'Resumed by user');         return { ok: true }; });
ipcMain.handle('creator-stop',   () => { creatorState.stopped = true; creatorState.paused = false; dbg('creator', 'warning', 'Stop requested by user'); return { ok: true }; });

async function runCreator(tasks, email, password) {
  let browser;
  try {
    const mode = store.get('browserMode', 'headless');
    dbg('creator', 'info', `=== CREATOR STARTED === ${tasks.length} task(s) | mode: ${mode}`);
    sendCreatorEvent('status', { message: 'Launching creator browser…' });

    const { browser: b, context } = await launchBrowser(mode, 'creator');
    browser = b;
    creatorState.browser = browser;
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
      dbg('creator', 'info', `--- Task ${i + 1}/${tasks.length}: "${task.accountName}" (${task.aliasType}) ---`);
      sendCreatorEvent('task-start', { id: task.id, message: `Creating alias for ${task.accountName}…` });

      try {
        dbg('creator', 'info', 'Navigating to dashboard…');
        await page.goto('https://my.cloaked.com/auth/login', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(1500);
        dbg('creator', 'success', `Dashboard loaded — URL: ${page.url()}`);

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

        dbg('creator', 'info', `Selecting alias type: ${task.aliasType}`);
        if (task.aliasType === 'phone') {
          const opt = await page.$('[data-testid*="phone"],[class*="phone"],button:has-text("Phone"),label:has-text("Phone")');
          if (opt) { await opt.click(); dbg('creator', 'success', 'Phone option selected'); }
          else dbg('creator', 'warning', 'Phone option not found — may already be selected or not required');
        } else {
          const opt = await page.$('[data-testid*="email"],[class*="email"],button:has-text("Email"),label:has-text("Email")');
          if (opt) { await opt.click(); dbg('creator', 'success', 'Email option selected'); }
          else dbg('creator', 'warning', 'Email option not found — may already be selected or not required');
        }
        await page.waitForTimeout(1000);

        dbg('creator', 'info', 'Looking for confirm/generate button…');
        const confirmBtn = await page.$('button:has-text("Generate"),button:has-text("Create"),button:has-text("Confirm"),button:has-text("Next"),button[type="submit"]');
        if (confirmBtn) { await confirmBtn.click(); dbg('creator', 'success', 'Confirm button clicked'); }
        else dbg('creator', 'warning', 'No confirm button found — may have auto-confirmed');
        await page.waitForTimeout(3000);

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
    creatorState.browser = null;
    creatorState.running = false;
    dbg('creator', 'success', '=== CREATOR COMPLETE ===');
    sendCreatorEvent('complete', { message: 'All tasks finished.' });

  } catch (err) {
    dbg('creator', 'error', `=== CREATOR FAILED === ${err.message}`);
    dbg('creator', 'verbose', err.stack || '(no stack)');
    if (browser) await browser.close().catch(() => {});
    creatorState.browser = null;
    creatorState.running = false;
    sendCreatorEvent('error', { message: err.message });
  }
}